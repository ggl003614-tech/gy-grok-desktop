// 存档要存到哪个线程头上。
//
// 这里存在的唯一理由是一个真实的数据损坏 bug：自动保存排定时捕获了 sessionId，
// 但真正落盘时才去读 itemsRef.current 取内容。平时两者同步看不出问题，
// 切线程时必然错位 —— setItems(新线程内容) 之后要等 loadSession 和
// upsert_local_session 两次往返，才轮到 setLocalSessionId(新线程 id)。
// 那 400ms 定时器在这个窗口里一响，就把新线程的对话写进了旧线程的存档，
// 顺带把旧线程的标题和 remoteSessionId 也改成新线程的。
//
// 修法是把内容和线程在同一刻绑死，落盘前再验一次身份。

import type { TimelineItem } from "./sessionUpdates";

export interface PersistJob {
  sessionId: string;
  items: TimelineItem[];
}

/**
 * 排定一次保存。内容在这一刻就取走，不留到触发时再读 —— 那是错位的来源。
 * 空内容不排：清空时间线是切线程的中间态，不该覆盖任何存档。
 */
export function schedulePersist(
  sessionId: string,
  items: readonly TimelineItem[],
): PersistJob | null {
  if (!sessionId || !items.length) return null;
  return { sessionId, items: [...items] };
}

/**
 * 落盘前的最后一道闸：这个存档任务还属于当前这个线程吗？
 * 人在这 400ms 里切走了的话，这次写入必须丢弃。
 */
export function isPersistJobValid(job: PersistJob, currentSessionId: string): boolean {
  return Boolean(job.sessionId) && job.sessionId === currentSessionId;
}
