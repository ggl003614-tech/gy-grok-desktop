export interface DeskWindowHandle {
  isMinimized: () => Promise<boolean>;
  unminimize: () => Promise<void>;
  show: () => Promise<void>;
  outerPosition: () => Promise<{ x: number; y: number }>;
  outerSize: () => Promise<{ width: number; height: number }>;
  center: () => Promise<void>;
  setFocus: () => Promise<void>;
}

export function windowNeedsRestore(
  x: number,
  y: number,
  width: number,
  height: number,
) {
  // Windows parks minimized windows near -32000,-32000.
  if (x <= -10_000 || y <= -10_000) return true;
  return width < 200 || height < 120;
}

export async function recoverDeskWindow(win: DeskWindowHandle) {
  if (await win.isMinimized()) {
    await win.unminimize();
  }
  await win.show();
  const pos = await win.outerPosition();
  const size = await win.outerSize();
  if (windowNeedsRestore(pos.x, pos.y, size.width, size.height)) {
    await win.center();
  }
  await win.setFocus();
}
