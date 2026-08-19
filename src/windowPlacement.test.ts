import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_WINDOW_SIZE,
  recoverDeskWindow,
  windowNeedsResize,
  windowNeedsRestore,
} from "./windowPlacement";

function handle(over: Partial<Parameters<typeof recoverDeskWindow>[0]> = {}) {
  return {
    isMinimized: async () => false,
    unminimize: vi.fn(async () => undefined),
    show: vi.fn(async () => undefined),
    outerPosition: async () => ({ x: 120, y: 80 }),
    outerSize: async () => ({ width: 1280, height: 820 }),
    setSize: vi.fn(async () => undefined),
    center: vi.fn(async () => undefined),
    setFocus: vi.fn(async () => undefined),
    ...over,
  };
}

describe("desk window placement", () => {
  it("treats the Windows minimized parking spot as lost", () => {
    expect(windowNeedsRestore(-21333, -21333, 158, 26)).toBe(true);
    expect(windowNeedsRestore(120, 80, 1280, 820)).toBe(false);
  });

  it("separates a collapsed size from a merely off-screen position", () => {
    expect(windowNeedsResize(14, 14)).toBe(true);
    expect(windowNeedsResize(1280, 820)).toBe(false);
    // 挪到屏幕外但尺寸正常：居中就够了，不该改大小
    expect(windowNeedsRestore(-21333, -21333, 1280, 820)).toBe(true);
    expect(windowNeedsResize(1280, 820)).toBe(false);
  });

  it("unminimizes and recenters a parked window", async () => {
    const win = handle({
      isMinimized: async () => true,
      outerPosition: async () => ({ x: -21333, y: -21333 }),
      outerSize: async () => ({ width: 158, height: 26 }),
    });
    await recoverDeskWindow(win);
    expect(win.unminimize).toHaveBeenCalledOnce();
    expect(win.center).toHaveBeenCalledOnce();
  });

  it("resizes a collapsed window instead of only centering it", async () => {
    // 14x14 居中之后还是 14x14，界面照样看不见 —— 这是真实碰到过的状态
    const win = handle({
      outerPosition: async () => ({ x: 0, y: 0 }),
      outerSize: async () => ({ width: 14, height: 14 }),
    });
    await recoverDeskWindow(win);
    expect(win.setSize).toHaveBeenCalledOnce();
    const size = win.setSize.mock.calls[0][0];
    expect(size.width).toBe(DEFAULT_WINDOW_SIZE.width);
    expect(size.height).toBe(DEFAULT_WINDOW_SIZE.height);
    expect(win.center).toHaveBeenCalledOnce();
  });

  it("leaves a healthy window alone", async () => {
    const win = handle();
    await recoverDeskWindow(win);
    expect(win.setSize).not.toHaveBeenCalled();
    expect(win.center).not.toHaveBeenCalled();
    expect(win.setFocus).toHaveBeenCalledOnce();
  });
});
