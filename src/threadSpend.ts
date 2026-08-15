import type { UsageInfo } from "./sessionUpdates";

export interface ThreadSpend {
  input: number;
  output: number;
  total: number;
}

export function emptySpend(): ThreadSpend {
  return { input: 0, output: 0, total: 0 };
}

export function isTurnSpend(usage: UsageInfo) {
  return usage.inputTokens != null || usage.outputTokens != null;
}

export function applyUsageToSpend(
  current: ThreadSpend,
  incoming: UsageInfo,
  last?: UsageInfo,
): ThreadSpend {
  if (!isTurnSpend(incoming)) return current;
  if (
    last &&
    last.inputTokens === incoming.inputTokens &&
    last.outputTokens === incoming.outputTokens &&
    last.totalTokens === incoming.totalTokens
  ) {
    return current;
  }
  const input = incoming.inputTokens ?? 0;
  const output = incoming.outputTokens ?? 0;
  const reported = incoming.totalTokens ?? input + output;
  const turn = input + output || reported;
  if (reported >= current.total && reported >= turn) {
    return {
      input: incoming.inputTokens ?? current.input,
      output: incoming.outputTokens ?? current.output,
      total: Math.max(reported, turn),
    };
  }
  return {
    input: current.input + input,
    output: current.output + output,
    total: current.total + turn,
  };
}

function storageKey(sessionId: string) {
  return `grok-desk.thread-spend.${sessionId}`;
}

export function loadThreadSpend(sessionId?: string): ThreadSpend {
  if (!sessionId) return emptySpend();
  try {
    const raw = JSON.parse(window.localStorage.getItem(storageKey(sessionId)) ?? "");
    const input = Number(raw.input) || 0;
    const output = Number(raw.output) || 0;
    const total = Number(raw.total) || input + output;
    return { input, output, total };
  } catch {
    return emptySpend();
  }
}

export function saveThreadSpend(sessionId: string, spend: ThreadSpend) {
  try {
    window.localStorage.setItem(storageKey(sessionId), JSON.stringify(spend));
  } catch {
    // ignore quota / private mode
  }
}
