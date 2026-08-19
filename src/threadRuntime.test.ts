import { describe, expect, it } from "vitest";
import {
  appendBackground,
  canStartConcurrentTurn,
  captureSnapshot,
  emptySnapshot,
  runningThreadCount,
  shouldReleaseComposer,
  threadBadge,
  updateTarget,
  type ThreadSnapshot,
} from "./threadRuntime";
import type { TimelineItem } from "./sessionUpdates";

const item = (id: string): TimelineItem => ({ id, kind: "assistant", text: id });

describe("update 路由", () => {
  it("当前线程的更新走原路径", () => {
    expect(updateTarget("s1", "s1", ["s1", "s2"])).toBe("active");
  });

  it("别的已知线程的更新进后台缓冲", () => {
    expect(updateTarget("s2", "s1", ["s1", "s2"])).toBe("background");
  });

  it("陌生 sessionId 直接丢掉，别污染当前对话", () => {
    // 进程重启后旧会话的 update 还可能留在管道里
    expect(updateTarget("ghost", "s1", ["s1", "s2"])).toBe("drop");
  });

  it("不带 sessionId 的更新当成当前线程的", () => {
    // 老 CLI 和部分通知确实不带，丢了就等于对话缺内容
    expect(updateTarget("", "s1", ["s1"])).toBe("active");
  });

  it("还没有当前线程时，认识的归后台，不认识的归当前", () => {
    expect(updateTarget("s2", "", ["s2"])).toBe("background");
    expect(updateTarget("s9", "", ["s2"])).toBe("active");
  });
});

describe("快照进出", () => {
  it("切走时封存，unseen 归零", () => {
    const snapshot = captureSnapshot("s1", {
      items: [item("a")], usage: { totalTokens: 5 }, tasks: [], busy: true,
    }, 100);
    expect(snapshot.unseen).toBe(0);
    expect(snapshot.busy).toBe(true);
    expect(snapshot.items).toHaveLength(1);
  });

  it("后台收到内容会累计未读", () => {
    let snapshot = emptySnapshot("s1", 0);
    snapshot = appendBackground(snapshot, (items) => [...items, item("a")], 1);
    snapshot = appendBackground(snapshot, (items) => [...items, item("b")], 2);
    expect(snapshot.unseen).toBe(2);
    expect(snapshot.items).toHaveLength(2);
  });

  it("apply 没改动就不算未读，也不换引用", () => {
    const snapshot = emptySnapshot("s1", 0);
    expect(appendBackground(snapshot, (items) => items, 1)).toBe(snapshot);
  });
});

describe("输入框解锁", () => {
  it("人还在这个线程上，跑完就解锁", () => {
    expect(shouldReleaseComposer("s1", "s1")).toBe(true);
  });

  it("人已经切走了，别去解锁另一个线程的输入框", () => {
    expect(shouldReleaseComposer("s1", "s2")).toBe(false);
  });

  it("没有 sessionId 时按老行为解锁，不然输入框会卡死", () => {
    expect(shouldReleaseComposer("", "s2")).toBe(true);
  });
});

describe("侧栏标记与并发闸门", () => {
  const snap = (over: Partial<ThreadSnapshot>): ThreadSnapshot => ({
    ...emptySnapshot("s", 0), ...over,
  });

  it("在跑显示 running，切走后有新内容显示 unseen", () => {
    expect(threadBadge(snap({ busy: true }))).toBe("running");
    expect(threadBadge(snap({ unseen: 3 }))).toBe("unseen");
    expect(threadBadge(snap({}))).toBe("none");
    expect(threadBadge(undefined)).toBe("none");
  });

  it("在跑优先于未读", () => {
    expect(threadBadge(snap({ busy: true, unseen: 5 }))).toBe("running");
  });

  it("只数后台在跑的，当前线程不算", () => {
    const snapshots = {
      s1: snap({ sessionId: "s1", busy: true }),
      s2: snap({ sessionId: "s2", busy: true }),
      s3: snap({ sessionId: "s3", busy: false }),
    };
    expect(runningThreadCount(snapshots, "s1")).toBe(1);
    expect(runningThreadCount(snapshots, "")).toBe(2);
  });

  it("生活模式锁住就不许再开一路", () => {
    expect(canStartConcurrentTurn({ lifeLocked: true, runningCount: 0, limit: 3 })).toBe(false);
  });

  it("没锁时按上限放行", () => {
    expect(canStartConcurrentTurn({ lifeLocked: false, runningCount: 2, limit: 3 })).toBe(true);
    expect(canStartConcurrentTurn({ lifeLocked: false, runningCount: 3, limit: 3 })).toBe(false);
  });
});
