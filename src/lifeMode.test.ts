import { describe, expect, it } from "vitest";
import {
  computeUnlockAt,
  decideLifeModeChange,
  demoLifeLock,
  evaluateLifeMode,
  inLifeWindow,
  isLifeSealed,
  isRuntimeSealed,
  localDateKey,
  nextWindowStart,
  normalizeLifeConfig,
  stageLifeRuntime,
  type LifeModeConfig,
  type LifeModeRuntime,
} from "./lifeMode";

function at(iso: string) {
  return new Date(iso);
}

function config(partial: Partial<LifeModeConfig> = {}): LifeModeConfig {
  return normalizeLifeConfig({
    enabled: true,
    dailyPercent: 20,
    unlockMode: "midnight",
    unlockTime: "08:00",
    restHours: 4,
    windows: [],
    ...partial,
  });
}

function runtime(partial: Partial<LifeModeRuntime> = {}, now = at("2026-08-15T10:00:00")): LifeModeRuntime {
  return {
    date: localDateKey(now),
    snapshotUsed: 40,
    windowSnapshots: {},
    lockedUntil: null,
    lockReason: null,
    ...partial,
  };
}

describe("life mode windows", () => {
  it("treats overnight ranges as wrapping midnight", () => {
    expect(inLifeWindow({ id: "n", start: "22:00", end: "06:00", percent: 10 }, 23 * 60)).toBe(true);
    expect(inLifeWindow({ id: "n", start: "22:00", end: "06:00", percent: 10 }, 3 * 60)).toBe(true);
    expect(inLifeWindow({ id: "n", start: "22:00", end: "06:00", percent: 10 }, 12 * 60)).toBe(false);
  });

  it("finds the next window start tomorrow when today is over", () => {
    const now = at("2026-08-15T20:00:00");
    const next = nextWindowStart([{ id: "a", start: "09:00", end: "18:00", percent: 20 }], now);
    expect(next.getDate()).toBe(16);
    expect(next.getHours()).toBe(9);
  });
});

describe("life mode lock", () => {
  it("stays open when disabled", () => {
    const now = at("2026-08-15T11:00:00");
    const result = evaluateLifeMode(config({ enabled: false }), runtime({}, now), 90, now);
    expect(result.lock.locked).toBe(false);
  });

  it("takes a first snapshot and locks after the daily percent is used", () => {
    const now = at("2026-08-15T11:00:00");
    const first = evaluateLifeMode(config(), runtime({ snapshotUsed: null }, now), 30, now);
    expect(first.lock.locked).toBe(false);
    expect(first.runtime.snapshotUsed).toBe(30);

    const later = evaluateLifeMode(config(), first.runtime, 50, at("2026-08-15T16:00:00"));
    expect(later.lock.locked).toBe(true);
    expect(later.lock.reason).toBe("quota");
    expect(later.lock.usedToday).toBe(20);
    expect(later.lock.until).toBeTruthy();
  });

  it("locks outside the allowed window until the next one", () => {
    const now = at("2026-08-15T21:00:00");
    const result = evaluateLifeMode(
      config({
        windows: [{ id: "day", start: "09:00", end: "18:00", percent: 15 }],
      }),
      runtime({}, now),
      44,
      now,
    );
    expect(result.lock.locked).toBe(true);
    expect(result.lock.reason).toBe("schedule");
    const until = new Date(result.lock.until ?? "");
    expect(until.getHours()).toBe(9);
    expect(until.getDate()).toBe(16);
  });

  it("uses the active window percent instead of the daily cap", () => {
    const now = at("2026-08-15T10:30:00");
    const start = runtime({ snapshotUsed: 10, windowSnapshots: { morning: 10 } }, now);
    const result = evaluateLifeMode(
      config({
        dailyPercent: 40,
        windows: [{ id: "morning", start: "09:00", end: "12:00", percent: 5 }],
      }),
      start,
      16,
      now,
    );
    expect(result.lock.locked).toBe(true);
    expect(result.lock.budget).toBe(5);
    expect(result.lock.usedToday).toBe(6);
  });

  it("keeps the lock even if the user raises the budget or turns the mode off", () => {
    const now = at("2026-08-15T14:00:00");
    const locked = runtime({
      snapshotUsed: 10,
      lockedUntil: "2026-08-16T00:00:00.000Z",
      lockReason: "quota",
    }, now);
    const raised = evaluateLifeMode(config({ dailyPercent: 50 }), locked, 20, now);
    expect(raised.lock.locked).toBe(true);
    expect(isLifeSealed(raised.lock, now)).toBe(true);
    const disabled = evaluateLifeMode(config({ enabled: false, dailyPercent: 50 }), locked, 20, now);
    expect(disabled.lock.locked).toBe(true);
  });

  it("allows turning the mode off only after the seal expires", () => {
    const now = at("2026-08-16T09:00:00");
    const expired = runtime({
      snapshotUsed: 10,
      lockedUntil: "2026-08-15T20:00:00.000Z",
      lockReason: "quota",
    }, now);
    const result = evaluateLifeMode(config({ enabled: false }), expired, 40, now);
    expect(result.lock.locked).toBe(false);
  });

  it("resets the daily snapshot on a new local day", () => {
    const now = at("2026-08-16T09:00:00");
    const yesterday = runtime({
      date: "2026-08-15",
      snapshotUsed: 70,
      lockedUntil: "2026-08-16T00:00:00.000Z",
      lockReason: "quota",
    }, at("2026-08-15T22:00:00"));
    const result = evaluateLifeMode(config(), yesterday, 72, now);
    expect(result.runtime.date).toBe("2026-08-16");
    expect(result.runtime.snapshotUsed).toBe(72);
    expect(result.lock.locked).toBe(false);
  });

  it("builds a preview lock without needing real credits", () => {
    const preview = demoLifeLock("quota", at("2026-08-15T10:00:00"));
    expect(preview.locked).toBe(true);
    expect(preview.reason).toBe("quota");
    expect(preview.budget).toBe(20);
  });

  it("computes rest-hour unlocks from the lock moment", () => {
    const now = at("2026-08-15T12:00:00");
    const until = computeUnlockAt(config({ unlockMode: "hours", restHours: 3 }), now);
    expect(until.getHours()).toBe(15);
  });
});

describe("life mode confirmation gate", () => {
  it("asks before turning the mode on", () => {
    const now = at("2026-08-15T11:00:00");
    const current = config({ enabled: false });
    const next = config({ enabled: true, dailyPercent: 40 });
    const decision = decideLifeModeChange(current, next, runtime({ snapshotUsed: 10 }, now), 20, now);
    expect(decision.action).toBe("confirm");
    if (decision.action !== "confirm") return;
    expect(decision.request.kind).toBe("enable");
    expect(decision.request.next.enabled).toBe(true);
  });

  it("asks before a slider change that would lock immediately", () => {
    const now = at("2026-08-15T11:00:00");
    const current = config({ dailyPercent: 50 });
    const next = config({ dailyPercent: 10 });
    const decision = decideLifeModeChange(current, next, runtime({ snapshotUsed: 10 }, now), 32, now);
    expect(decision.action).toBe("confirm");
    if (decision.action !== "confirm") return;
    expect(decision.request.kind).toBe("seal");
    expect(decision.request.lock.locked).toBe(true);
    expect(decision.request.lock.until).toBeTruthy();
  });

  it("uses the stronger seal prompt when turning on would lock right now", () => {
    const now = at("2026-08-15T21:00:00");
    const current = config({ enabled: false });
    const next = config({
      enabled: true,
      windows: [{ id: "day", start: "09:00", end: "18:00", percent: 20 }],
    });
    const decision = decideLifeModeChange(current, next, runtime({}, now), 44, now);
    expect(decision.action).toBe("confirm");
    if (decision.action !== "confirm") return;
    expect(decision.request.kind).toBe("seal");
    expect(decision.request.lock.reason).toBe("schedule");
  });

  it("applies a safer budget raise without a prompt", () => {
    const now = at("2026-08-15T11:00:00");
    const current = config({ dailyPercent: 20 });
    const next = config({ dailyPercent: 60 });
    const decision = decideLifeModeChange(current, next, runtime({ snapshotUsed: 10 }, now), 25, now);
    expect(decision).toEqual({ action: "apply", config: next });
  });

  it("seals immediately when today's cap is used, with no last-chance prompt", () => {
    const now = at("2026-08-15T16:00:00");
    const unlocked = runtime({ snapshotUsed: 30, lockedUntil: null }, now);
    const preview = evaluateLifeMode(config({ dailyPercent: 20 }), unlocked, 50, now);
    expect(preview.lock.locked).toBe(true);
    const staged = stageLifeRuntime(unlocked, preview.runtime, now);
    expect(staged.needsUsageConfirm).toBe(false);
    expect(isRuntimeSealed(staged.runtime, now)).toBe(true);
    expect(staged.runtime.lockedUntil).toBeTruthy();
  });

  it("lets the user turn the mode off in settings before the cap is hit", () => {
    const now = at("2026-08-15T11:00:00");
    const current = config({ dailyPercent: 20 });
    const next = config({ enabled: false, dailyPercent: 20 });
    const decision = decideLifeModeChange(current, next, runtime({ snapshotUsed: 10 }, now), 18, now);
    expect(decision).toEqual({ action: "apply", config: next });
  });

  it("keeps an already confirmed lock without asking again", () => {
    const now = at("2026-08-15T16:00:00");
    const locked = runtime({
      snapshotUsed: 30,
      lockedUntil: "2026-08-16T00:00:00.000Z",
      lockReason: "quota",
    }, now);
    const preview = evaluateLifeMode(config(), locked, 50, now);
    const staged = stageLifeRuntime(locked, preview.runtime, now);
    expect(staged.needsUsageConfirm).toBe(false);
    expect(isRuntimeSealed(staged.runtime, now)).toBe(true);
  });
});
