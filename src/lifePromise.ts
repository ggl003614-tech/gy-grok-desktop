import { isRuntimeSealed, type LifeModeRuntime } from "./lifeMode";
import { effortStage } from "./effort";

export type LifeBreakSource = "cli" | "tamper";

export interface LifePromiseState {
  broken: boolean;
  source: LifeBreakSource | null;
  scolded: boolean;
  xhighBlocked: boolean;
}

export interface LifeCliUnlock {
  at: string;
  untilWas: string | null;
  via: "grok";
}

export interface LifeIntegrityInput {
  runtime: LifeModeRuntime;
  promise: LifePromiseState;
  shadowUntil: string | null;
  cliUnlock: LifeCliUnlock | null;
  now?: Date;
}

export interface LifeIntegrityResult {
  promise: LifePromiseState;
  clearShadow: boolean;
  consumeCli: boolean;
}

export const LIFE_PROMISE_KEY = "grok-desk.life-mode.promise";
export const LIFE_SEAL_SHADOW_KEY = "grok-desk.life-mode.seal-shadow";
export const LIFE_CLI_UNLOCK_KEY = "grok-desk.life-mode.cli-unlock";

export function defaultLifePromise(): LifePromiseState {
  return {
    broken: false,
    source: null,
    scolded: false,
    xhighBlocked: false,
  };
}

export function normalizeLifePromise(raw: unknown): LifePromiseState {
  const base = defaultLifePromise();
  if (!raw || typeof raw !== "object") return base;
  const value = raw as Partial<LifePromiseState>;
  return {
    broken: value.broken === true,
    source: value.source === "cli" || value.source === "tamper" ? value.source : null,
    scolded: value.scolded === true,
    xhighBlocked: value.xhighBlocked === true,
  };
}

export function normalizeCliUnlock(raw: unknown): LifeCliUnlock | null {
  if (!raw || typeof raw !== "object") return null;
  const value = raw as Partial<LifeCliUnlock>;
  if (value.via !== "grok") return null;
  if (typeof value.at !== "string") return null;
  return {
    at: value.at,
    untilWas: typeof value.untilWas === "string" ? value.untilWas : null,
    via: "grok",
  };
}

export function markCliUnlockRecord(untilWas: string | null, now = new Date()): LifeCliUnlock {
  return {
    at: now.toISOString(),
    untilWas,
    via: "grok",
  };
}

export function sameLifePromise(left: LifePromiseState, right: LifePromiseState) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function futureIso(value: string | null | undefined, now: Date) {
  if (!value) return false;
  const until = new Date(value).getTime();
  return Number.isFinite(until) && until > now.getTime();
}

export function inspectLifeIntegrity(input: LifeIntegrityInput): LifeIntegrityResult {
  const now = input.now ?? new Date();
  const sealed = isRuntimeSealed(input.runtime, now);
  const shadowHolds = futureIso(input.shadowUntil, now);
  let promise = normalizeLifePromise(input.promise);

  if (input.cliUnlock) {
    if (promise.scolded && !promise.broken && !promise.xhighBlocked) {
      return { promise, clearShadow: !shadowHolds, consumeCli: true };
    }
    if (!promise.xhighBlocked || promise.source !== "cli") {
      promise = {
        broken: true,
        source: "cli",
        scolded: false,
        xhighBlocked: true,
      };
    }
    return { promise, clearShadow: !shadowHolds, consumeCli: false };
  }

  if (shadowHolds && !sealed) {
    if (!promise.xhighBlocked) {
      promise = {
        broken: true,
        source: "tamper",
        scolded: false,
        xhighBlocked: true,
      };
    }
    return { promise, clearShadow: false, consumeCli: false };
  }

  if (!shadowHolds && input.shadowUntil) {
    return { promise, clearShadow: true, consumeCli: false };
  }

  return { promise, clearShadow: false, consumeCli: false };
}

export function markScolded(state: LifePromiseState): LifePromiseState {
  return { ...state, scolded: true };
}

export function acceptLifePromise(state: LifePromiseState): LifePromiseState {
  return {
    broken: false,
    source: state.source,
    scolded: true,
    xhighBlocked: false,
  };
}

export function xhighRequiresPromise(state: LifePromiseState, effort: string) {
  if (!state.xhighBlocked) return false;
  return effortStage({ value: effort, label: effort }) === "xhigh";
}

function readJson(key: string): unknown {
  try {
    return JSON.parse(window.localStorage.getItem(key) ?? "");
  } catch {
    return null;
  }
}

function writeJson(key: string, value: unknown) {
  try {
    if (value == null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // ignore quota / private mode
  }
}

export function loadLifePromise(): LifePromiseState {
  return normalizeLifePromise(readJson(LIFE_PROMISE_KEY));
}

export function saveLifePromise(state: LifePromiseState) {
  writeJson(LIFE_PROMISE_KEY, normalizeLifePromise(state));
}

export function loadSealShadow(): string | null {
  const raw = readJson(LIFE_SEAL_SHADOW_KEY);
  if (typeof raw === "string") return raw;
  if (raw && typeof raw === "object" && typeof (raw as { until?: unknown }).until === "string") {
    return (raw as { until: string }).until;
  }
  return null;
}

export function saveSealShadow(until: string | null) {
  writeJson(LIFE_SEAL_SHADOW_KEY, until ? { until } : null);
}

export function loadCliUnlock(): LifeCliUnlock | null {
  return normalizeCliUnlock(readJson(LIFE_CLI_UNLOCK_KEY));
}

export function saveCliUnlock(record: LifeCliUnlock | null) {
  writeJson(LIFE_CLI_UNLOCK_KEY, record);
}
