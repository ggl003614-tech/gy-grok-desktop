export type LifeUnlockMode = "midnight" | "time" | "hours";
export type LifeLockReason = "quota" | "schedule" | "rest";
export type LifePreviewKind = LifeLockReason | "broke" | "xhigh";

export interface LifeWindow {
  id: string;
  start: string;
  end: string;
  percent: number;
}

export interface LifeModeConfig {
  enabled: boolean;
  dailyPercent: number;
  unlockMode: LifeUnlockMode;
  unlockTime: string;
  restHours: number;
  windows: LifeWindow[];
}

export interface LifeModeRuntime {
  date: string;
  snapshotUsed: number | null;
  windowSnapshots: Record<string, number>;
  lockedUntil: string | null;
  lockReason: LifeLockReason | null;
}

export interface LifeLockView {
  locked: boolean;
  reason: LifeLockReason | null;
  until: string | null;
  usedToday: number;
  budget: number;
  inWindow: boolean;
}

export const LIFE_CONFIG_KEY = "grok-desk.life-mode.config";
export const LIFE_RUNTIME_KEY = "grok-desk.life-mode.runtime";

export function defaultLifeConfig(): LifeModeConfig {
  return {
    enabled: false,
    dailyPercent: 20,
    unlockMode: "midnight",
    unlockTime: "08:00",
    restHours: 4,
    windows: [],
  };
}

export function emptyLifeRuntime(now = new Date()): LifeModeRuntime {
  return {
    date: localDateKey(now),
    snapshotUsed: null,
    windowSnapshots: {},
    lockedUntil: null,
    lockReason: null,
  };
}

export function localDateKey(now: Date) {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function parseHm(value: string) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) return 0;
  const hours = Math.max(0, Math.min(23, Number(match[1])));
  const minutes = Math.max(0, Math.min(59, Number(match[2])));
  return hours * 60 + minutes;
}

export function minutesOfDay(now: Date) {
  return now.getHours() * 60 + now.getMinutes();
}

export function clampPercent(value: number) {
  if (!Number.isFinite(value)) return 20;
  return Math.max(1, Math.min(100, Math.round(value)));
}

export function newLifeWindow(): LifeWindow {
  return {
    id: `w-${Math.random().toString(36).slice(2, 9)}`,
    start: "09:00",
    end: "18:00",
    percent: 20,
  };
}

export function inLifeWindow(window: LifeWindow, minutes: number) {
  const start = parseHm(window.start);
  const end = parseHm(window.end);
  if (start === end) return true;
  if (start < end) return minutes >= start && minutes < end;
  return minutes >= start || minutes < end;
}

export function nextWindowStart(windows: LifeWindow[], now: Date) {
  if (!windows.length) return startOfNextDay(now);
  const mins = minutesOfDay(now);
  let best = Number.POSITIVE_INFINITY;
  for (const window of windows) {
    const start = parseHm(window.start);
    const wait = start > mins ? start - mins : start + 24 * 60 - mins;
    if (wait < best) best = wait;
  }
  return new Date(now.getTime() + best * 60 * 1000);
}

export function startOfNextDay(now: Date) {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 0, 0);
}

export function nextClockTime(now: Date, hm: string) {
  const minutes = parseHm(hm);
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate(), Math.floor(minutes / 60), minutes % 60, 0, 0);
  if (next.getTime() <= now.getTime()) next.setDate(next.getDate() + 1);
  return next;
}

export function computeUnlockAt(config: LifeModeConfig, now: Date) {
  if (config.unlockMode === "hours") {
    const hours = Math.max(1, Math.min(24, config.restHours || 4));
    return new Date(now.getTime() + hours * 60 * 60 * 1000);
  }
  if (config.unlockMode === "time") return nextClockTime(now, config.unlockTime || "08:00");
  return startOfNextDay(now);
}

export function normalizeLifeConfig(raw: unknown): LifeModeConfig {
  const base = defaultLifeConfig();
  if (!raw || typeof raw !== "object") return base;
  const value = raw as Partial<LifeModeConfig>;
  const windows = Array.isArray(value.windows)
    ? value.windows
        .map((window, index) => ({
          id: typeof window?.id === "string" && window.id ? window.id : `w-${index}`,
          start: typeof window?.start === "string" ? window.start : "09:00",
          end: typeof window?.end === "string" ? window.end : "18:00",
          percent: clampPercent(Number(window?.percent) || base.dailyPercent),
        }))
        .slice(0, 6)
    : [];
  return {
    enabled: value.enabled === true,
    dailyPercent: clampPercent(Number(value.dailyPercent) || 20),
    unlockMode: value.unlockMode === "time" || value.unlockMode === "hours" ? value.unlockMode : "midnight",
    unlockTime: typeof value.unlockTime === "string" && /^\d{1,2}:\d{2}$/.test(value.unlockTime) ? value.unlockTime : "08:00",
    restHours: Math.max(1, Math.min(24, Math.round(Number(value.restHours) || 4))),
    windows,
  };
}

export function normalizeLifeRuntime(raw: unknown, now = new Date()): LifeModeRuntime {
  const empty = emptyLifeRuntime(now);
  if (!raw || typeof raw !== "object") return empty;
  const value = raw as Partial<LifeModeRuntime>;
  return {
    date: typeof value.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value.date) ? value.date : empty.date,
    snapshotUsed: typeof value.snapshotUsed === "number" && Number.isFinite(value.snapshotUsed) ? value.snapshotUsed : null,
    windowSnapshots:
      value.windowSnapshots && typeof value.windowSnapshots === "object"
        ? Object.fromEntries(
            Object.entries(value.windowSnapshots).filter((entry): entry is [string, number] => typeof entry[1] === "number"),
          )
        : {},
    lockedUntil: typeof value.lockedUntil === "string" ? value.lockedUntil : null,
    lockReason: value.lockReason === "quota" || value.lockReason === "schedule" || value.lockReason === "rest" ? value.lockReason : null,
  };
}

function unlockView(runtime: LifeModeRuntime, usedToday: number, budget: number, inWindow: boolean): { lock: LifeLockView; runtime: LifeModeRuntime } {
  return {
    lock: {
      locked: false,
      reason: null,
      until: null,
      usedToday,
      budget,
      inWindow,
    },
    runtime: { ...runtime, lockedUntil: null, lockReason: null },
  };
}

export function evaluateLifeMode(
  config: LifeModeConfig,
  runtime: LifeModeRuntime,
  usedPercent: number | null | undefined,
  now = new Date(),
): { lock: LifeLockView; runtime: LifeModeRuntime } {
  let next = { ...runtime, windowSnapshots: { ...runtime.windowSnapshots } };
  const today = localDateKey(now);
  if (next.date !== today) {
    next = {
      date: today,
      snapshotUsed: null,
      windowSnapshots: {},
      lockedUntil: next.lockedUntil && new Date(next.lockedUntil).getTime() > now.getTime() ? next.lockedUntil : null,
      lockReason: next.lockedUntil && new Date(next.lockedUntil).getTime() > now.getTime() ? next.lockReason : null,
    };
  }

  const windows = config.windows;
  const minutes = minutesOfDay(now);
  const active = windows.find((window) => inLifeWindow(window, minutes));
  const inWindow = windows.length === 0 || Boolean(active);
  const budget = clampPercent(active?.percent ?? config.dailyPercent);

  if (typeof usedPercent === "number") {
    if (next.snapshotUsed == null) next.snapshotUsed = usedPercent;
    if (usedPercent + 0.4 < next.snapshotUsed) next.snapshotUsed = usedPercent;
    if (active && next.windowSnapshots[active.id] == null) next.windowSnapshots[active.id] = usedPercent;
    if (active && usedPercent + 0.4 < next.windowSnapshots[active.id]) next.windowSnapshots[active.id] = usedPercent;
  }

  const snapshot = active ? next.windowSnapshots[active.id] ?? next.snapshotUsed : next.snapshotUsed;
  const usedToday = typeof usedPercent === "number" && snapshot != null
    ? Math.max(0, usedPercent - snapshot)
    : 0;

  if (next.lockedUntil) {
    const until = new Date(next.lockedUntil);
    if (!Number.isNaN(until.getTime()) && until.getTime() > now.getTime()) {
      return {
        lock: {
          locked: true,
          reason: next.lockReason ?? "rest",
          until: until.toISOString(),
          usedToday,
          budget,
          inWindow,
        },
        runtime: next,
      };
    }
    next.lockedUntil = null;
    next.lockReason = null;
  }

  if (!config.enabled) {
    return unlockView(next, usedToday, budget, true);
  }

  if (windows.length > 0 && !active) {
    const until = nextWindowStart(windows, now);
    next.lockedUntil = until.toISOString();
    next.lockReason = "schedule";
    return {
      lock: {
        locked: true,
        reason: "schedule",
        until: until.toISOString(),
        usedToday,
        budget,
        inWindow: false,
      },
      runtime: next,
    };
  }

  if (typeof usedPercent === "number" && snapshot != null && usedToday + 0.05 >= budget) {
    const until = computeUnlockAt(config, now);
    next.lockedUntil = until.toISOString();
    next.lockReason = config.unlockMode === "hours" ? "rest" : "quota";
    return {
      lock: {
        locked: true,
        reason: next.lockReason,
        until: until.toISOString(),
        usedToday,
        budget,
        inWindow,
      },
      runtime: next,
    };
  }

  return {
    lock: {
      locked: false,
      reason: null,
      until: null,
      usedToday,
      budget,
      inWindow,
    },
    runtime: next,
  };
}

export function isLifeSealed(lock: LifeLockView, now = new Date()) {
  if (!lock.locked || !lock.until) return false;
  const until = new Date(lock.until).getTime();
  return Number.isFinite(until) && until > now.getTime();
}

export function isRuntimeSealed(runtime: LifeModeRuntime, now = new Date()) {
  if (!runtime.lockedUntil) return false;
  const until = new Date(runtime.lockedUntil).getTime();
  return Number.isFinite(until) && until > now.getTime();
}

export type LifeConfirmKind = "enable" | "seal" | "usage";

export interface LifeConfirmRequest {
  kind: LifeConfirmKind;
  next: LifeModeConfig;
  lock: LifeLockView;
}

export type LifeModeChangeDecision =
  | { action: "apply"; config: LifeModeConfig }
  | { action: "confirm"; request: LifeConfirmRequest };

export function decideLifeModeChange(
  current: LifeModeConfig,
  next: LifeModeConfig,
  runtime: LifeModeRuntime,
  usedPercent: number | null | undefined,
  now = new Date(),
): LifeModeChangeDecision {
  if (isRuntimeSealed(runtime, now)) {
    return { action: "apply", config: current };
  }
  if (current.enabled && !next.enabled) {
    return { action: "apply", config: next };
  }
  const nextPreview = evaluateLifeMode(next, runtime, usedPercent, now);
  const currentPreview = evaluateLifeMode(current, runtime, usedPercent, now);
  const wouldNewlySeal = isLifeSealed(nextPreview.lock, now) && !isLifeSealed(currentPreview.lock, now);
  if (wouldNewlySeal) {
    return { action: "confirm", request: { kind: "seal", next, lock: nextPreview.lock } };
  }
  if (!current.enabled && next.enabled) {
    return { action: "confirm", request: { kind: "enable", next, lock: nextPreview.lock } };
  }
  return { action: "apply", config: next };
}

export function stageLifeRuntime(
  _current: LifeModeRuntime,
  preview: LifeModeRuntime,
  _now = new Date(),
): { runtime: LifeModeRuntime; needsUsageConfirm: boolean } {
  return { runtime: preview, needsUsageConfirm: false };
}

export function demoLifeLock(reason: LifeLockReason = "quota", now = new Date()): LifeLockView {
  const hours = reason === "rest" ? 3 : reason === "schedule" ? 12 : 10;
  return {
    locked: true,
    reason,
    until: new Date(now.getTime() + hours * 60 * 60 * 1000).toISOString(),
    usedToday: reason === "schedule" ? 4 : 20,
    budget: 20,
    inWindow: reason !== "schedule",
  };
}

export function sameLifeRuntime(left: LifeModeRuntime, right: LifeModeRuntime) {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function loadLifeConfig(): LifeModeConfig {
  try {
    return normalizeLifeConfig(JSON.parse(window.localStorage.getItem(LIFE_CONFIG_KEY) ?? ""));
  } catch {
    return defaultLifeConfig();
  }
}

export function saveLifeConfig(config: LifeModeConfig) {
  try {
    window.localStorage.setItem(LIFE_CONFIG_KEY, JSON.stringify(normalizeLifeConfig(config)));
  } catch {
    // ignore quota / private mode
  }
}

export function loadLifeRuntime(): LifeModeRuntime {
  try {
    return normalizeLifeRuntime(JSON.parse(window.localStorage.getItem(LIFE_RUNTIME_KEY) ?? ""));
  } catch {
    return emptyLifeRuntime();
  }
}

export function saveLifeRuntime(runtime: LifeModeRuntime) {
  try {
    window.localStorage.setItem(LIFE_RUNTIME_KEY, JSON.stringify(runtime));
  } catch {
    // ignore
  }
}
