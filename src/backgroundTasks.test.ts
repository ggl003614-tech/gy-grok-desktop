import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  reduceBackgroundTasks,
  runningSummary,
  parseSubagentId,
  type BackgroundTask,
} from "./backgroundTasks";

const root = dirname(fileURLToPath(import.meta.url));

// 这批 payload 是真的从 `grok agent stdio` 抓下来的，不是手编的。
const fixture: Record<string, unknown>[] = JSON.parse(
  readFileSync(join(root, "fixtures", "background-tasks.json"), "utf8"),
);

const replay = (updates: Record<string, unknown>[]) =>
  updates.reduce<BackgroundTask[]>((tasks, update, index) => reduceBackgroundTasks(tasks, update, index), []);

describe("background task registry", () => {
  it("认出后台终端命令，带上 pid 和命令原文", () => {
    const tasks = replay(fixture);
    const command = tasks.find((task) => task.kind === "command");
    expect(command).toBeDefined();
    expect(command!.id).toBe("01a0180d-5857-7b23-9b37-b1ecf4447ca4");
    expect(command!.title).toContain("setTimeout");
    expect(command!.pid).toBe(14056);
    expect(command!.status).toBe("running");
  });

  it("从回执正文里挖出 subagent_id", () => {
    expect(
      parseSubagentId("Subagent started in background.\nsubagent_id: 01a0180d-d8b0-7ea0-9a72-56fdb0b7c027\ntype: general-purpose"),
    ).toBe("01a0180d-d8b0-7ea0-9a72-56fdb0b7c027");
    expect(parseSubagentId("没有 id 的一段话")).toBe("");
  });

  it("子智能体登记时用描述当标题，不用 spawn_subagent 这个工具名", () => {
    const tasks = replay(fixture);
    const sub = tasks.find((task) => task.kind === "subagent");
    expect(sub).toBeDefined();
    expect(sub!.id).toBe("01a0180d-d8b0-7ea0-9a72-56fdb0b7c027");
    expect(sub!.title).toBe("Count .rs files");
    expect(sub!.subagentType).toBe("general-purpose");
  });

  it("TaskOutput 刷新状态时保留登记时的干净标题，不被 [subagent:…] 前缀污染", () => {
    const tasks = replay(fixture);
    const sub = tasks.find((task) => task.kind === "subagent")!;
    expect(sub.title).toBe("Count .rs files");
    expect(sub.title).not.toContain("[subagent");
    expect(sub.progress).toContain("turn 1");
    expect(sub.durationSecs).toBeGreaterThan(0);
  });

  it("同一个任务被反复轮询也只占一行", () => {
    const tasks = replay([...fixture, ...fixture, ...fixture]);
    const ids = tasks.map((task) => task.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("非零退出码算失败，哪怕 CLI 说它 completed", () => {
    const tasks = reduceBackgroundTasks([], {
      sessionUpdate: "tool_call_update",
      rawOutput: {
        type: "TaskOutput",
        Result: { task_id: "t1", command: "npm test", status: "completed", exit_code: 1 },
      },
    }, 0);
    expect(tasks[0].status).toBe("failed");
    expect(tasks[0].title).toBe("npm test");
  });

  it("[bg] 前缀不进标题", () => {
    const tasks = reduceBackgroundTasks([], {
      sessionUpdate: "tool_call_update",
      rawOutput: {
        type: "TaskOutput",
        Result: { task_id: "t2", command: "[bg] npm run dev", status: "running", exit_code: null },
      },
    }, 0);
    expect(tasks[0].title).toBe("npm run dev");
  });

  it("认不出来的 update 原样返回同一个引用", () => {
    const before: BackgroundTask[] = [];
    expect(reduceBackgroundTasks(before, { sessionUpdate: "agent_message_chunk" }, 0)).toBe(before);
    expect(reduceBackgroundTasks(before, { sessionUpdate: "tool_call", title: "grep" }, 0)).toBe(before);
  });

  it("状态行只数还在跑的，全跑完就空", () => {
    const label = (kind: string, count: number) =>
      kind === "command" ? `${count} 个命令` : `${count} 个子智能体`;
    const tasks: BackgroundTask[] = [
      { id: "a", kind: "command", title: "x", status: "running", firstSeen: 0 },
      { id: "b", kind: "subagent", title: "y", status: "running", firstSeen: 1 },
      { id: "c", kind: "subagent", title: "z", status: "running", firstSeen: 2 },
      { id: "d", kind: "command", title: "w", status: "completed", firstSeen: 3 },
    ];
    expect(runningSummary(tasks, label)).toBe("1 个命令 · 2 个子智能体");
    expect(runningSummary(tasks.map((task) => ({ ...task, status: "completed" as const })), label)).toBe("");
  });
});

describe("background task surface", () => {
  const app = readFileSync(join(root, "App.tsx"), "utf8");
  const i18n = readFileSync(join(root, "i18n.ts"), "utf8");
  const css = readFileSync(join(root, "App.css"), "utf8");

  it("update 流真的喂进了登记簿", () => {
    expect(app).toMatch(/setBackgroundTasks\(\(current\) => reduceBackgroundTasks\(current, update, Date\.now\(\)\)\)/);
  });

  it("换线程会清空任务表，不把上个线程的任务带过来", () => {
    expect(app).toMatch(/setBackgroundTasks\(\[\]\)/);
  });

  it("输入栏有状态提示，活动面板有清单", () => {
    expect(app).toMatch(/tasks-chip/);
    expect(app).toMatch(/task-list/);
    expect(app).toMatch(/tasksRunning/);
  });

  it("中英文都补齐了文案", () => {
    for (const key of ["tasks.title", "tasks.commandCount", "tasks.subagentCount", "tasks.openPanel"]) {
      expect(i18n.split(key).length - 1).toBe(2);
    }
  });

  it("样式在", () => {
    expect(css).toMatch(/\.tasks-chip/);
    expect(css).toMatch(/\.task-list/);
  });
});
