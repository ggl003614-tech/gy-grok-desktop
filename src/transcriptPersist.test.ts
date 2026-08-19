import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { isPersistJobValid, schedulePersist, type PersistJob } from "./transcriptPersist";
import type { TimelineItem } from "./sessionUpdates";

const root = dirname(fileURLToPath(import.meta.url));

const line = (text: string): TimelineItem => ({ id: text, kind: "assistant", text });

/** 复现旧写法：排定时记 sessionId，落盘时才现读内容。 */
function persistTheOldBrokenWay(capturedSessionId: string, liveItems: TimelineItem[]) {
  return { sessionId: capturedSessionId, items: liveItems };
}

describe("切线程时的存档错位", () => {
  it("旧写法会把 B 的内容写进 A 的存档（这就是丢记忆）", () => {
    const threadA = [line("A 的对话")];
    // 切到 B：setItems(B 的内容) 已经发生，setLocalSessionId 还没轮到
    const threadB = [line("B 的对话")];
    const written = persistTheOldBrokenWay("thread-A", threadB);
    expect(written.sessionId).toBe("thread-A");
    expect(written.items).toEqual(threadB);
    expect(written.items).not.toEqual(threadA); // A 的存档被 B 覆盖了
  });

  it("新写法在排定那一刻就把内容和线程绑死", () => {
    const threadA = [line("A 的对话")];
    const job = schedulePersist("thread-A", threadA)!;
    // 之后时间线换成 B 的内容，已排定的任务不受影响
    expect(job.sessionId).toBe("thread-A");
    expect(job.items).toEqual(threadA);
  });

  it("绑定是拷贝，后续改动原数组不会污染已排定的任务", () => {
    const items = [line("第一句")];
    const job = schedulePersist("t", items)!;
    items.push(line("切完线程之后才来的"));
    expect(job.items).toHaveLength(1);
  });

  it("空时间线不排存档 —— 那是切线程的中间态，不能拿去覆盖", () => {
    expect(schedulePersist("thread-A", [])).toBeNull();
  });

  it("没有线程 id 就不排", () => {
    expect(schedulePersist("", [line("x")])).toBeNull();
  });
});

describe("落盘前的身份复核", () => {
  const job: PersistJob = { sessionId: "thread-A", items: [line("A 的对话")] };

  it("还在原线程上，放行", () => {
    expect(isPersistJobValid(job, "thread-A")).toBe(true);
  });

  it("人已经切到 B 了，这次写入必须丢弃", () => {
    expect(isPersistJobValid(job, "thread-B")).toBe(false);
  });

  it("当前没有线程时也不写 —— 宁可不存，不能存错", () => {
    expect(isPersistJobValid(job, "")).toBe(false);
  });
});

describe("切线程时的写入顺序（回归防线）", () => {
  const app = readFileSync(join(root, "App.tsx"), "utf8");

  it("localSessionId 必须和 setItems(restored) 挨在一起更新", () => {
    // 这是数据损坏的根因：以前 localSessionId 要等 loadSession 和
    // upsert_local_session 两次 await 之后才更新，中间那段窗口里
    // 自动保存会把新线程的内容写进旧线程的存档。
    const switchBlock = app.slice(
      app.indexOf("if (gen !== threadSwitchGen.current) return;"),
      app.indexOf("if (restored.length) setThreadRestoring(false);"),
    );
    expect(switchBlock).toMatch(/setLocalSessionId\(known\?\.id \?\? ""\)/);
    expect(switchBlock).toMatch(/localSessionIdRef\.current = known\?\.id \?\? ""/);
  });

  it("自动保存排定时就绑定内容，不在触发时读 ref", () => {
    expect(app).toMatch(/const job = schedulePersist\(localSessionId, items\)/);
    expect(app).toMatch(/isPersistJobValid\(job, localSessionIdRef\.current\)/);
  });

  it("改标题和 remoteSessionId 前要确认还是当前线程", () => {
    expect(app).toMatch(/workspaceId && sessionId === localSessionIdRef\.current/);
  });
});
