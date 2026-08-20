// 用量统计。
//
// 数据来自两处，各补各的短板：
//   - 磁盘会话（~/.grok/sessions 的 summary.json）：日期、消息数、模型、cwd。
//     它有全部历史，但没有累计 token —— summary 里那个是上下文占用，不是花掉的量。
//   - 每线程花销（localStorage，threadSpend）：真实的 input/output 累计，
//     但只覆盖在这个 GUI 里跑过的线程。
//
// 所以 token 总量按「有多少算多少」处理，并且如实告诉界面覆盖了几条线程 ——
// 显示一个偏低的数比显示一个编出来的数好。

export interface UsageSession {
  sessionId: string;
  createdAt?: string;
  updatedAt?: string;
  numChatMessages?: number;
  modelId?: string;
  /** "subagent" 的不计入，它们不是人开的对话。 */
  kind?: string;
}

export interface UsageTotals {
  sessions: number;
  messages: number;
  /** 已知线程的 token 累计。 */
  tokens: number;
  /** tokens 覆盖了几条线程，用来说明这个数的可信度。 */
  tokensFromThreads: number;
  activeDays: number;
  currentStreak: number;
  longestStreak: number;
  /** 0-23，没有数据时是 null。 */
  peakHour: number | null;
  favoriteModel: string | null;
}

export interface DayBucket {
  /** YYYY-MM-DD（本地时区）。 */
  day: string;
  sessions: number;
  messages: number;
}

export type UsageRange = "all" | "30d" | "7d";

const localDay = (date: Date) => {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
};

/** summary.json 的时间戳有 ISO 字符串，也有毫秒数字串。 */
export function parseStamp(value?: string): Date | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (/^\d{10,}$/.test(trimmed)) {
    const millis = trimmed.length <= 11 ? Number(trimmed) * 1000 : Number(trimmed);
    const date = new Date(millis);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  const date = new Date(trimmed);
  return Number.isNaN(date.getTime()) ? null : date;
}

const sessionDate = (session: UsageSession) =>
  parseStamp(session.updatedAt) ?? parseStamp(session.createdAt);

/** 子智能体不算 —— 它们是 Grok 自己起的，不是人开的对话。 */
export const isCountableSession = (session: UsageSession) => session.kind !== "subagent";

export function filterByRange(
  sessions: UsageSession[],
  range: UsageRange,
  now: number,
): UsageSession[] {
  const countable = sessions.filter(isCountableSession);
  if (range === "all") return countable;
  const days = range === "30d" ? 30 : 7;
  const cutoff = now - days * 24 * 60 * 60 * 1000;
  return countable.filter((session) => {
    const date = sessionDate(session);
    return date ? date.getTime() >= cutoff : false;
  });
}

/**
 * 连续活跃天数。今天没用过就从昨天算起 —— 一早打开就看到「断签」
 * 太打击人，而且那天还没过完。
 */
export function streaks(days: string[], today: string): { current: number; longest: number } {
  if (!days.length) return { current: 0, longest: 0 };
  const sorted = [...new Set(days)].sort();
  const toIndex = (day: string) => Math.floor(Date.parse(`${day}T00:00:00`) / 86_400_000);

  let longest = 1;
  let run = 1;
  for (let i = 1; i < sorted.length; i++) {
    run = toIndex(sorted[i]) - toIndex(sorted[i - 1]) === 1 ? run + 1 : 1;
    if (run > longest) longest = run;
  }

  const todayIndex = toIndex(today);
  const lastIndex = toIndex(sorted[sorted.length - 1]);
  const gap = todayIndex - lastIndex;
  if (gap > 1) return { current: 0, longest };
  let current = 1;
  for (let i = sorted.length - 1; i > 0; i--) {
    if (toIndex(sorted[i]) - toIndex(sorted[i - 1]) !== 1) break;
    current += 1;
  }
  return { current, longest };
}

/** 按天汇总，用来画热力图。 */
export function dayBuckets(sessions: UsageSession[]): DayBucket[] {
  const map = new Map<string, DayBucket>();
  for (const session of sessions) {
    const date = sessionDate(session);
    if (!date) continue;
    const day = localDay(date);
    const bucket = map.get(day) ?? { day, sessions: 0, messages: 0 };
    bucket.sessions += 1;
    bucket.messages += session.numChatMessages ?? 0;
    map.set(day, bucket);
  }
  return [...map.values()].sort((left, right) => left.day.localeCompare(right.day));
}

export function summarize(
  sessions: UsageSession[],
  tokensBySession: Record<string, number>,
  now: number,
): UsageTotals {
  const buckets = dayBuckets(sessions);
  const hours = new Array(24).fill(0);
  const models = new Map<string, number>();
  let messages = 0;
  let tokens = 0;
  let tokensFromThreads = 0;

  for (const session of sessions) {
    messages += session.numChatMessages ?? 0;
    const date = sessionDate(session);
    if (date) hours[date.getHours()] += 1;
    const model = session.modelId?.trim();
    if (model) models.set(model, (models.get(model) ?? 0) + 1);
    const spend = tokensBySession[session.sessionId];
    if (spend > 0) {
      tokens += spend;
      tokensFromThreads += 1;
    }
  }

  const peak = hours.reduce(
    (best, count, hour) => (count > best.count ? { hour, count } : best),
    { hour: -1, count: 0 },
  );
  const favorite = [...models.entries()].sort((left, right) => right[1] - left[1])[0];
  const { current, longest } = streaks(
    buckets.map((bucket) => bucket.day),
    localDay(new Date(now)),
  );

  return {
    sessions: sessions.length,
    messages,
    tokens,
    tokensFromThreads,
    activeDays: buckets.length,
    currentStreak: current,
    longestStreak: longest,
    peakHour: peak.count > 0 ? peak.hour : null,
    favoriteModel: favorite ? favorite[0] : null,
  };
}

/**
 * 热力图的格子：最近 weeks 周，按列＝周、行＝周几铺开。
 * 返回的是行优先的二维数组，方便直接渲染成 7 行。
 */
export function heatmapGrid(
  buckets: DayBucket[],
  now: number,
  weeks = 20,
): { day: string; messages: number }[][] {
  const byDay = new Map(buckets.map((bucket) => [bucket.day, bucket.messages]));
  const end = new Date(now);
  end.setHours(0, 0, 0, 0);
  // 让最后一列落在本周：先退到本周日，再往前数 weeks 周。
  const start = new Date(end);
  start.setDate(start.getDate() - end.getDay() - (weeks - 1) * 7);

  const rows: { day: string; messages: number }[][] = Array.from({ length: 7 }, () => []);
  for (let week = 0; week < weeks; week++) {
    for (let weekday = 0; weekday < 7; weekday++) {
      const cell = new Date(start);
      cell.setDate(start.getDate() + week * 7 + weekday);
      const day = localDay(cell);
      rows[weekday].push({ day, messages: cell > end ? -1 : byDay.get(day) ?? 0 });
    }
  }
  return rows;
}

/** 热力图配色档位：0 = 没用过，1-4 越来越深。-1 是未来的格子。 */
export function heatLevel(messages: number, busiest: number): number {
  if (messages < 0) return -1;
  if (messages === 0 || busiest <= 0) return 0;
  const ratio = messages / busiest;
  if (ratio > 0.66) return 4;
  if (ratio > 0.33) return 3;
  if (ratio > 0.1) return 2;
  return 1;
}
