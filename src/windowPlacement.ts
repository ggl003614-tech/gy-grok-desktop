import { LogicalSize } from "@tauri-apps/api/dpi";

/** 跟 tauri.conf.json 里 app.windows[0] 的 width/height 保持一致 */
export const DEFAULT_WINDOW_SIZE = { width: 1280, height: 820 };

export interface DeskWindowHandle {
  isMinimized: () => Promise<boolean>;
  unminimize: () => Promise<void>;
  show: () => Promise<void>;
  outerPosition: () => Promise<{ x: number; y: number }>;
  outerSize: () => Promise<{ width: number; height: number }>;
  setSize: (size: LogicalSize) => Promise<void>;
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

/** 尺寸塌了（不只是被挪到屏幕外），居中救不回来，必须重新给宽高 */
export function windowNeedsResize(width: number, height: number) {
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
    // 只 center 是不够的：14x14 的窗口居中之后还是 14x14，
    // 界面照样看不见，看起来就像卡在加载。尺寸塌了就得先量回来。
    if (windowNeedsResize(size.width, size.height)) {
      await win.setSize(
        new LogicalSize(DEFAULT_WINDOW_SIZE.width, DEFAULT_WINDOW_SIZE.height),
      );
    }
    await win.center();
  }
  await win.setFocus();
}
