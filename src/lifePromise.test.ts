import { describe, expect, it } from "vitest";
import { emptyLifeRuntime, type LifeModeRuntime } from "./lifeMode";
import {
  acceptLifePromise,
  defaultLifePromise,
  inspectLifeIntegrity,
  markCliUnlockRecord,
  markScolded,
  xhighRequiresPromise,
} from "./lifePromise";

function at(iso: string) {
  return new Date(iso);
}

function unlocked(partial: Partial<LifeModeRuntime> = {}): LifeModeRuntime {
  return {
    ...emptyLifeRuntime(at("2026-08-15T11:00:00")),
    snapshotUsed: 81,
    lockedUntil: null,
    lockReason: null,
    ...partial,
  };
}

describe("life promise after a backdoor unlock", () => {
  it("treats an explicit Grok/CLI unlock as a broken promise", () => {
    const now = at("2026-08-15T11:10:00");
    const result = inspectLifeIntegrity({
      runtime: unlocked(),
      promise: defaultLifePromise(),
      shadowUntil: "2026-08-15T16:00:00.000Z",
      cliUnlock: markCliUnlockRecord("2026-08-15T16:00:00.000Z", now),
      now,
    });
    expect(result.promise.broken).toBe(true);
    expect(result.promise.source).toBe("cli");
    expect(result.promise.scolded).toBe(false);
    expect(result.promise.xhighBlocked).toBe(true);
  });

  it("treats a vanished seal before the unlock time as tampering", () => {
    const now = at("2026-08-15T11:10:00");
    const result = inspectLifeIntegrity({
      runtime: unlocked(),
      promise: defaultLifePromise(),
      shadowUntil: "2026-08-15T16:00:00.000Z",
      cliUnlock: null,
      now,
    });
    expect(result.promise.broken).toBe(true);
    expect(result.promise.source).toBe("tamper");
    expect(result.promise.xhighBlocked).toBe(true);
  });

  it("does not accuse a lock that is still sealed", () => {
    const now = at("2026-08-15T11:10:00");
    const result = inspectLifeIntegrity({
      runtime: unlocked({
        lockedUntil: "2026-08-15T16:00:00.000Z",
        lockReason: "quota",
      }),
      promise: defaultLifePromise(),
      shadowUntil: "2026-08-15T16:00:00.000Z",
      cliUnlock: null,
      now,
    });
    expect(result.promise.broken).toBe(false);
    expect(result.promise.xhighBlocked).toBe(false);
  });

  it("does not accuse a lock that opened at the promised time", () => {
    const now = at("2026-08-16T00:05:00");
    const result = inspectLifeIntegrity({
      runtime: unlocked(),
      promise: defaultLifePromise(),
      shadowUntil: "2026-08-15T16:00:00.000Z",
      cliUnlock: null,
      now,
    });
    expect(result.promise.broken).toBe(false);
    expect(result.clearShadow).toBe(true);
  });

  it("keeps the penalty after the scold is dismissed", () => {
    const scolded = markScolded({
      ...defaultLifePromise(),
      broken: true,
      source: "cli",
      xhighBlocked: true,
    });
    expect(scolded.scolded).toBe(true);
    expect(scolded.xhighBlocked).toBe(true);
    expect(xhighRequiresPromise(scolded, "xhigh")).toBe(true);
    expect(xhighRequiresPromise(scolded, "high")).toBe(false);
  });

  it("lets extra-high through only after a fresh promise", () => {
    const blocked = {
      ...defaultLifePromise(),
      broken: true,
      source: "cli" as const,
      scolded: true,
      xhighBlocked: true,
    };
    expect(xhighRequiresPromise(blocked, "xhigh")).toBe(true);
    const next = acceptLifePromise(blocked);
    expect(next.broken).toBe(false);
    expect(next.xhighBlocked).toBe(false);
    expect(xhighRequiresPromise(next, "xhigh")).toBe(false);
  });

  it("does not block extra-high when nothing was broken", () => {
    expect(xhighRequiresPromise(defaultLifePromise(), "xhigh")).toBe(false);
  });

  it("consumes a leftover CLI mark after the user already promised", () => {
    const now = at("2026-08-15T12:00:00");
    const result = inspectLifeIntegrity({
      runtime: unlocked(),
      promise: acceptLifePromise({
        ...defaultLifePromise(),
        broken: true,
        source: "cli",
        xhighBlocked: true,
      }),
      shadowUntil: null,
      cliUnlock: markCliUnlockRecord("2026-08-15T16:00:00.000Z", now),
      now,
    });
    expect(result.promise.xhighBlocked).toBe(false);
    expect(result.consumeCli).toBe(true);
  });
});
