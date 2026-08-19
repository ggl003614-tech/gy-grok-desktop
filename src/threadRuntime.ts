// 多线程并发的状态层。
//
// 背景：一个 `grok agent stdio` 进程能同时开多个会话，实测两路 session/prompt 的
// 输出在时间线上真的穿插（不是排队）。但界面以前只认一个会话——客户端存一个
// sessionId，App 存一份 items，一个 busy 布尔锁住整个输入框。
//
// 这里不重写那套东西，而是在旁边加一层缓冲：正在看的线程照旧走原来的 setItems 路径，
// 切走的线程把状态存进快照，继续收它自己的 update。回来的时候把快照换回去。
// 好处是当前线程的行为一个字节都没变，风险只落在「后台那几个」身上。

import type { BackgroundTask } from "./backgroundTasks";
import type { TimelineItem, UsageInfo } from "./sessionUpdates";

export interface ThreadSnapshot {
  /** 远端会话 ID，也是 session/update 上带的那个。 */
  sessionId: string;
  items: TimelineItem[];
  usage: UsageInfo;
  tasks: BackgroundTask[];
  /** 这个线程有没有一轮还没跑完。 */
  busy: boolean;
  /** 切走之后收到过几条 update，用来在侧栏点个「有新内容」。 */
  unseen: number;
  updatedAt: number;
}

export type UpdateTarget = "active" | "background" | "drop";

/**
 * 一条通知该落到哪儿。
 *
 * 没带 sessionId 的更新只能当成当前线程的——老版本 CLI 和某些通知确实不带。
 * 带了但既不是当前线程、也不在缓冲区里的，说明是上一个连接的残留（进程重启后
 * 旧会话的 update 还在管道里），直接丢掉，否则会污染当前对话。
 */
export function updateTarget(
  updateSessionId: string,
  activeSessionId: string,
  known: readonly string[],
): UpdateTarget {
  if (!updateSessionId) return "active";
  if (!activeSessionId) return known.includes(updateSessionId) ? "background" : "active";
  if (updateSessionId === activeSessionId) return "active";
  return known.includes(updateSessionId) ? "background" : "drop";
}

export const emptySnapshot = (sessionId: string, now: number): ThreadSnapshot => ({
  sessionId,
  items: [],
  usage: {},
  tasks: [],
  busy: false,
  unseen: 0,
  updatedAt: now,
});

/** 切走时把当前状态封存起来。unseen 归零——刚看过的东西不算未读。 */
export function captureSnapshot(
  sessionId: string,
  state: Pick<ThreadSnapshot, "items" | "usage" | "tasks" | "busy">,
  now: number,
): ThreadSnapshot {
  return { sessionId, ...state, unseen: 0, updatedAt: now };
}

/** 后台线程收到一条已经解析好的时间线项。 */
export function appendBackground(
  snapshot: ThreadSnapshot,
  apply: (items: TimelineItem[]) => TimelineItem[],
  now: number,
): ThreadSnapshot {
  const items = apply(snapshot.items);
  if (items === snapshot.items) return snapshot;
  return { ...snapshot, items, unseen: snapshot.unseen + 1, updatedAt: now };
}

/**
 * 一轮跑完了。只有在这个线程仍然是当前线程时才该去解锁输入框——
 * 人已经切走的话，解锁的必须是快照里的 busy，不是界面上那个。
 */
export function shouldReleaseComposer(finishedSessionId: string, activeSessionId: string) {
  return !finishedSessionId || finishedSessionId === activeSessionId;
}

/** 侧栏上那个「还在跑」的点：正在跑，或者切走之后攒了新内容。 */
export function threadBadge(snapshot: ThreadSnapshot | undefined): "running" | "unseen" | "none" {
  if (!snapshot) return "none";
  if (snapshot.busy) return "running";
  return snapshot.unseen > 0 ? "unseen" : "none";
}

/** 后台还有几个线程在跑，用来决定要不要在界面上提示。 */
export function runningThreadCount(
  snapshots: Readonly<Record<string, ThreadSnapshot>>,
  activeSessionId: string,
): number {
  return Object.values(snapshots).filter(
    (snapshot) => snapshot.busy && snapshot.sessionId !== activeSessionId,
  ).length;
}

/**
 * 生活模式锁住之后并发要收回单路，否则「替人踩刹车」的软件自己装了个油门。
 * 返回还能不能再开一路。
 */
export function canStartConcurrentTurn(options: {
  lifeLocked: boolean;
  runningCount: number;
  limit: number;
}): boolean {
  if (options.lifeLocked) return false;
  return options.runningCount < options.limit;
}
