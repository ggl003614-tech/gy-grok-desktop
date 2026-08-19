// goal 自动续跑。
//
// 实测（scratchpad/acp-goal.mjs）：/goal 的续跑回合在 agent stdio 通道上不会自己醒。
// TUI 里是宿主每轮结束后踢下一轮；走 ACP 时宿主就是这个 GUI。不踢的话，
// goal 每轮结束就停在原地 —— 用户看到的就是「写一下停一下」。
// 探针数据：目标要写 3 行，第一轮 157s 返回 end_turn 只写了 1 行，
// 之后 145 秒零自发回合。
//
// 所以：GUI 在一轮正常结束后自动补一条续跑提示。停下来的条件要么是模型
// 按哨兵协议报告 goal 结束，要么是保险丝（轮数上限）烧断，要么用户手动打断。

/** 续跑提示语。哨兵协议：goal 不在活跃状态就只回哨兵词，别的什么都不做。 */
export const GOAL_NUDGE =
  "继续推进当前的 goal。如果 goal 已经完成、被暂停或者不存在，" +
  "只回复 GOAL_DONE 这一个词，不要调用任何工具。";

export const GOAL_DONE_SENTINEL = "GOAL_DONE";

/** 连续自动续跑的保险丝。goal 自己有 token 预算，这里只防失控循环。 */
export const GOAL_MAX_AUTO_ROUNDS = 40;

export type GoalCommand = "start" | "stop" | "resume" | "passive";

/**
 * 用户输入的是不是 /goal 命令，以及它对自动续跑意味着什么。
 * status 是只读查询，不改变 goal 状态，归为 passive。
 */
export function parseGoalCommand(text: string): GoalCommand | null {
  const match = /^\/goal(?:\s+(.*))?$/s.exec(text.trim());
  if (!match) return null;
  const argument = (match[1] ?? "").trim();
  if (!argument) return "passive";
  const word = argument.split(/\s+/)[0].toLowerCase();
  if (word === "clear" || word === "pause") return "stop";
  if (word === "resume") return "resume";
  if (word === "status") return "passive";
  return "start";
}

/** 模型按哨兵协议报告 goal 已经不在跑了。 */
export function isGoalDoneReply(assistantText: string): boolean {
  const trimmed = assistantText.trim();
  if (!trimmed) return false;
  // 只认「整条回复就是哨兵词」，前后最多容忍几个标点。正文里顺嘴提到
  // GOAL_DONE 的长回答不算 —— 那说明它还在干活，只是话多。
  // 注意不能用长度阈值：80 个汉字已经是一大段正文了。
  return /^[^A-Za-z0-9_]{0,4}GOAL_DONE[^A-Za-z0-9_]{0,4}$/.test(trimmed);
}

export interface GoalContinueDecision {
  continue: boolean;
  /** 不续跑时给界面的原因，用于状态提示；正常续跑是空串。 */
  reason: "" | "done" | "cap" | "locked" | "switched" | "inactive" | "cancelled";
}

/** 一轮结束后要不要自动踢下一轮。 */
export function decideGoalContinue(options: {
  goalActive: boolean;
  /** 这一轮是被用户手动停掉的（stop 按钮 / 发新消息打断）。 */
  cancelled: boolean;
  /** 已经连续自动续了几轮。 */
  autoRounds: number;
  lifeLocked: boolean;
  /** 这一轮所属会话还是不是当前会话（用户切走就先不踢，回来再说）。 */
  sameSession: boolean;
  lastAssistantText: string;
}): GoalContinueDecision {
  if (!options.goalActive) return { continue: false, reason: "inactive" };
  if (options.cancelled) return { continue: false, reason: "cancelled" };
  if (isGoalDoneReply(options.lastAssistantText)) return { continue: false, reason: "done" };
  if (options.lifeLocked) return { continue: false, reason: "locked" };
  if (options.autoRounds >= GOAL_MAX_AUTO_ROUNDS) return { continue: false, reason: "cap" };
  if (!options.sameSession) return { continue: false, reason: "switched" };
  return { continue: true, reason: "" };
}
