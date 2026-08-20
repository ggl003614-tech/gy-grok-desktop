import { describe, expect, it } from "vitest";
import {
  dayBuckets,
  filterByRange,
  heatLevel,
  heatmapGrid,
  isCountableSession,
  parseStamp,
  streaks,
  summarize,
  type UsageSession,
} from "./usageStats";

// 不带 Z：按本地时间解析。代码是按本地日期分桶的（面向用户的看板就该这样），
// 测试跟着用本地时间，免得在别的时区跑出不同结果。
const at = (day: string, hour = 10) => `${day}T${String(hour).padStart(2, "0")}:00:00`;
const NOW = Date.parse("2026-08-20T12:00:00");

const session = (over: Partial<UsageSession> & { sessionId: string }): UsageSession => ({
  numChatMessages: 10,
  ...over,
});

describe("时间戳解析", () => {
  it("认 ISO 字符串", () => {
    expect(parseStamp("2026-08-19T03:25:55Z")?.getUTCFullYear()).toBe(2026);
  });

  it("认毫秒数字串 —— 本机数据库里就是这种", () => {
    // 1786645475514 是真实数据里出现过的格式
    expect(parseStamp("1786645475514")).toBeInstanceOf(Date);
  });

  it("空值和垃圾值返回 null，不抛", () => {
    expect(parseStamp(undefined)).toBeNull();
    expect(parseStamp("   ")).toBeNull();
    expect(parseStamp("不是时间")).toBeNull();
  });
});

describe("哪些会话算数", () => {
  it("子智能体不计入 —— 那是 Grok 自己起的", () => {
    expect(isCountableSession(session({ sessionId: "a", kind: "subagent" }))).toBe(false);
    expect(isCountableSession(session({ sessionId: "b" }))).toBe(true);
  });

  it("按时间范围筛，同时滤掉子智能体", () => {
    const list = [
      session({ sessionId: "new", updatedAt: at("2026-08-19") }),
      session({ sessionId: "old", updatedAt: at("2026-01-01") }),
      session({ sessionId: "sub", updatedAt: at("2026-08-19"), kind: "subagent" }),
    ];
    expect(filterByRange(list, "7d", NOW).map((s) => s.sessionId)).toEqual(["new"]);
    expect(filterByRange(list, "all", NOW).map((s) => s.sessionId)).toEqual(["new", "old"]);
  });
});

describe("连续天数", () => {
  it("连着三天就是 3", () => {
    expect(streaks(["2026-08-18", "2026-08-19", "2026-08-20"], "2026-08-20")).toEqual({
      current: 3,
      longest: 3,
    });
  });

  it("今天还没用不算断 —— 那天还没过完", () => {
    expect(streaks(["2026-08-18", "2026-08-19"], "2026-08-20").current).toBe(2);
  });

  it("隔了两天以上就断了", () => {
    expect(streaks(["2026-08-10", "2026-08-11"], "2026-08-20").current).toBe(0);
  });

  it("最长记录跟当前无关，断了也留着", () => {
    const result = streaks(
      ["2026-01-01", "2026-01-02", "2026-01-03", "2026-01-04", "2026-08-19"],
      "2026-08-20",
    );
    expect(result.longest).toBe(4);
    expect(result.current).toBe(1);
  });

  it("没有数据就是 0", () => {
    expect(streaks([], "2026-08-20")).toEqual({ current: 0, longest: 0 });
  });

  it("同一天多条只算一天", () => {
    expect(streaks(["2026-08-20", "2026-08-20", "2026-08-20"], "2026-08-20").current).toBe(1);
  });
});

describe("汇总", () => {
  const list = [
    session({ sessionId: "a", updatedAt: at("2026-08-19", 11), numChatMessages: 12, modelId: "grok-4.6" }),
    session({ sessionId: "b", updatedAt: at("2026-08-20", 11), numChatMessages: 8, modelId: "grok-4.6" }),
    session({ sessionId: "c", updatedAt: at("2026-08-20", 22), numChatMessages: 5, modelId: "grok-mini" }),
  ];

  it("会话数、消息数、活跃天数", () => {
    const totals = summarize(list, {}, NOW);
    expect(totals.sessions).toBe(3);
    expect(totals.messages).toBe(25);
    expect(totals.activeDays).toBe(2);
  });

  it("token 只算得到数据的线程，并如实报覆盖了几条", () => {
    const totals = summarize(list, { a: 5000, b: 3000 }, NOW);
    expect(totals.tokens).toBe(8000);
    // c 没有本地花销记录，不能瞎编
    expect(totals.tokensFromThreads).toBe(2);
  });

  it("最常用模型按会话数取", () => {
    expect(summarize(list, {}, NOW).favoriteModel).toBe("grok-4.6");
  });

  it("没有任何数据时不崩，峰值小时是 null", () => {
    const empty = summarize([], {}, NOW);
    expect(empty.sessions).toBe(0);
    expect(empty.peakHour).toBeNull();
    expect(empty.favoriteModel).toBeNull();
  });

  it("时间戳缺失的会话不进日期统计，但仍计入会话数", () => {
    const totals = summarize([session({ sessionId: "x" })], {}, NOW);
    expect(totals.sessions).toBe(1);
    expect(totals.activeDays).toBe(0);
  });
});

describe("热力图", () => {
  it("按天汇总并排序", () => {
    const buckets = dayBuckets([
      session({ sessionId: "b", updatedAt: at("2026-08-20"), numChatMessages: 3 }),
      session({ sessionId: "a", updatedAt: at("2026-08-19"), numChatMessages: 4 }),
      session({ sessionId: "c", updatedAt: at("2026-08-20"), numChatMessages: 2 }),
    ]);
    expect(buckets.map((b) => b.day)).toEqual(["2026-08-19", "2026-08-20"]);
    expect(buckets[1].messages).toBe(5);
    expect(buckets[1].sessions).toBe(2);
  });

  it("网格是 7 行、每行 weeks 列", () => {
    const grid = heatmapGrid([], NOW, 20);
    expect(grid).toHaveLength(7);
    for (const row of grid) expect(row).toHaveLength(20);
  });

  it("未来的格子标成 -1，不画成「那天没用」", () => {
    const grid = heatmapGrid([], NOW, 4);
    const future = grid.flat().filter((cell) => cell.messages === -1);
    expect(future.length).toBeGreaterThan(0);
  });

  it("配色档位按占最忙那天的比例分", () => {
    expect(heatLevel(-1, 100)).toBe(-1);
    expect(heatLevel(0, 100)).toBe(0);
    expect(heatLevel(5, 100)).toBe(1);
    expect(heatLevel(20, 100)).toBe(2);
    expect(heatLevel(50, 100)).toBe(3);
    expect(heatLevel(90, 100)).toBe(4);
  });

  it("一天都没用过时不除以零", () => {
    expect(heatLevel(0, 0)).toBe(0);
  });
});
