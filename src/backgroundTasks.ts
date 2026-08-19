// 后台任务登记簿。
//
// Grok CLI 早就在并发跑东西了：`background: true` 的终端命令、spawn_subagent 起的
// 子会话、monitor 流。它们全都伪装成普通 tool_call 混在对话里，所以界面上看不出
// 「有几件事还在跑」。这个模块把它们从 update 流里认出来，攒成一张表。
//
// 认领的依据全部来自真实抓包（src/fixtures/background-tasks.json）：
//   - 后台命令：rawOutput.type === "BackgroundTaskStarted"，带 task_id / command / pid
//   - 子智能体：spawn_subagent 完成时正文里写着 `subagent_id: <uuid>`
//   - 状态刷新：rawOutput.type === "TaskOutput"，Result 里有 status / duration / output
// 标题上的 `[bg] …` 和 `[subagent:type] …` 前缀是同一批信息的展示层，不拿来当依据。

export type BackgroundTaskKind = "command" | "subagent";
export type BackgroundTaskStatus = "running" | "completed" | "failed";

export interface BackgroundTask {
  id: string;
  kind: BackgroundTaskKind;
  /** 命令原文，或子智能体的任务描述。 */
  title: string;
  /** 只有子智能体有，比如 general-purpose。 */
  subagentType?: string;
  status: BackgroundTaskStatus;
  pid?: number;
  exitCode?: number | null;
  durationSecs?: number;
  /** TaskOutput 里那段进度描述，子智能体会写「turn 1, 3 tool calls, 29K/500K tokens」。 */
  progress?: string;
  /** 第一次见到它的时刻，用来排序；agent 不一定给 started。 */
  firstSeen: number;
}

type JsonObject = Record<string, unknown>;

const object = (value: unknown): JsonObject =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonObject)
    : {};

const text = (value: unknown): string => (typeof value === "string" ? value : "");

/** tool_call 和 tool_call_update 的字段有时挂在 update 上，有时挂在 update.toolCall 上。 */
function pick(update: JsonObject, key: string): unknown {
  const direct = update[key];
  if (direct !== undefined) return direct;
  return object(update.toolCall)[key];
}

function toolName(update: JsonObject): string {
  const meta = object(pick(update, "_meta"));
  return text(object(meta["x.ai/tool"]).name);
}

/** 把 content: [{type:"content", content:{type:"text", text}}] 拍平成一段文字。 */
function contentText(update: JsonObject): string {
  const content = pick(update, "content");
  if (!Array.isArray(content)) return "";
  return content
    .map((entry) => {
      const outer = object(entry);
      const inner = object(outer.content);
      return text(inner.text) || text(outer.text);
    })
    .filter(Boolean)
    .join("\n");
}

/** 子智能体启动回执长这样：`subagent_id: 01a0180d-…`。 */
export function parseSubagentId(body: string): string {
  return /subagent_id:\s*([0-9a-fA-F-]{8,})/.exec(body)?.[1] ?? "";
}

/** 状态字符串来自 CLI，只有 running / completed / failed 三种落点。 */
function normalizeStatus(raw: string, exitCode: number | null | undefined): BackgroundTaskStatus {
  const value = raw.toLowerCase();
  if (value === "running" || value === "pending" || value === "in_progress") return "running";
  if (typeof exitCode === "number" && exitCode !== 0) return "failed";
  if (value === "failed" || value === "error" || value === "killed") return "failed";
  return "completed";
}

function upsert(tasks: BackgroundTask[], next: BackgroundTask): BackgroundTask[] {
  const index = tasks.findIndex((task) => task.id === next.id);
  if (index < 0) return [...tasks, next];
  const merged = { ...tasks[index], ...next, firstSeen: tasks[index].firstSeen };
  if (tasks[index].kind === "subagent") {
    // TaskOutput 的 command 字段带着 `[subagent:…]` 前缀，不如登记时的描述干净。
    merged.kind = "subagent";
    merged.subagentType = next.subagentType ?? tasks[index].subagentType;
    merged.title = tasks[index].title || next.title;
  }
  return tasks.map((task, position) => (position === index ? merged : task));
}

/**
 * 吃一条 session/update，返回新的任务表。认不出来就原样返回（同一个引用），
 * 调用方可以拿引用相等判断「这条无关」，省一次渲染。
 */
export function reduceBackgroundTasks(
  tasks: BackgroundTask[],
  update: JsonObject,
  now: number,
): BackgroundTask[] {
  const type = text(update.sessionUpdate);
  if (type !== "tool_call" && type !== "tool_call_update") return tasks;

  const rawOutput = object(pick(update, "rawOutput"));
  const outputType = text(rawOutput.type);

  // 1. 后台终端命令启动
  if (outputType === "BackgroundTaskStarted") {
    const id = text(rawOutput.task_id);
    if (!id) return tasks;
    return upsert(tasks, {
      id,
      kind: "command",
      title: text(rawOutput.command) || text(pick(update, "title")),
      status: normalizeStatus(text(rawOutput.status) || "running", undefined),
      pid: Number(rawOutput.pid) || undefined,
      firstSeen: now,
    });
  }

  // 2. 子智能体启动。task_id 不在结构化字段里，只在回执正文里。
  if (toolName(update) === "spawn_subagent") {
    const id = parseSubagentId(contentText(update) || text(rawOutput.text));
    if (!id) return tasks;
    const input = object(pick(update, "rawInput"));
    return upsert(tasks, {
      id,
      kind: "subagent",
      title: text(input.description) || text(pick(update, "title")),
      subagentType: text(input.subagent_type) || undefined,
      status: "running",
      firstSeen: now,
    });
  }

  // 3. 轮询回来的状态刷新，命令和子智能体共用这一条路。
  if (outputType === "TaskOutput") {
    const result = object(rawOutput.Result ?? rawOutput.result);
    const id = text(result.task_id);
    if (!id) return tasks;
    const exitCode =
      result.exit_code === null || result.exit_code === undefined
        ? undefined
        : Number(result.exit_code);
    const command = text(result.command);
    const subagent = /^\[subagent:([^\]]+)\]\s*(.*)$/.exec(command);
    return upsert(tasks, {
      id,
      kind: subagent ? "subagent" : "command",
      title: subagent ? subagent[2] : command.replace(/^\[bg\]\s*/, ""),
      subagentType: subagent ? subagent[1] : undefined,
      status: normalizeStatus(text(result.status), exitCode),
      exitCode,
      durationSecs: Number(result.duration_secs) || undefined,
      progress: text(result.output).split("\n").find((line) => /^Progress:/.test(line))?.slice(9).trim(),
      firstSeen: now,
    });
  }

  return tasks;
}

export const isTaskRunning = (task: BackgroundTask) => task.status === "running";

/** 「◎ 1 个命令 · 2 个子智能体还在跑」——没有在跑的就返回空串。 */
export function runningSummary(
  tasks: BackgroundTask[],
  label: (kind: BackgroundTaskKind, count: number) => string,
): string {
  const running = tasks.filter(isTaskRunning);
  if (!running.length) return "";
  const kinds: BackgroundTaskKind[] = ["command", "subagent"];
  return kinds
    .map((kind) => ({ kind, count: running.filter((task) => task.kind === kind).length }))
    .filter((entry) => entry.count > 0)
    .map((entry) => label(entry.kind, entry.count))
    .join(" · ");
}
