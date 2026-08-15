import { describe, expect, it, vi } from "vitest";
import { recoverDeskWindow, windowNeedsRestore } from "./windowPlacement";

describe("desk window placement", () => {
  it("treats the Windows minimized parking spot as lost", () => {
    expect(windowNeedsRestore(-21333, -21333, 158, 26)).toBe(true);
    expect(windowNeedsRestore(120, 80, 1280, 820)).toBe(false);
  });

  it("unminimizes and recenters a parked window", async () => {
    const center = vi.fn(async () => undefined);
    const unminimize = vi.fn(async () => undefined);
    await recoverDeskWindow({
      isMinimized: async () => true,
      unminimize,
      show: async () => undefined,
      outerPosition: async () => ({ x: -21333, y: -21333 }),
      outerSize: async () => ({ width: 158, height: 26 }),
      center,
      setFocus: async () => undefined,
    });
    expect(unminimize).toHaveBeenCalledOnce();
    expect(center).toHaveBeenCalledOnce();
  });
});
