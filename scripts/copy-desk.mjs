import { copyFileSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const built = join(root, "src-tauri", "target", "release", "grok-desk.exe");
const destDir = join(root, "app");
const dest = join(destDir, "grok-desk.exe");
const fallback = join(destDir, "grok-desk-new.exe");

mkdirSync(destDir, { recursive: true });

let copiedTo = dest;
try {
  copyFileSync(built, dest);
} catch (error) {
  if (error && error.code === "EBUSY") {
    copyFileSync(built, fallback);
    copiedTo = fallback;
    console.warn("grok-desk.exe 正在运行，新版本已写成 app\\grok-desk-new.exe。关掉旧窗口后再打开即可。");
  } else {
    throw error;
  }
}

const size = statSync(copiedTo).size;
if (size < 10_000_000) {
  throw new Error(`独立包异常偏小（${size} 字节）。请用 npm run build:desk，不要只用 cargo build --release。`);
}

writeFileSync(
  join(destDir, "启动 Grok Desk.cmd"),
  [
    "@echo off",
    "chcp 65001 >nul",
    "cd /d \"%~dp0\"",
    "set \"APP=%~dp0grok-desk.exe\"",
    "if not exist \"%APP%\" if exist \"%~dp0grok-desk-new.exe\" set \"APP=%~dp0grok-desk-new.exe\"",
    "if not exist \"%APP%\" (",
    "  echo 还没有 GY Grok 程序。",
    "  pause",
    "  exit /b 1",
    ")",
    "start \"\" \"%APP%\"",
    "",
  ].join("\r\n"),
  "utf8",
);

writeFileSync(
  join(destDir, "安装到这台电脑.cmd"),
  [
    "@echo off",
    "chcp 65001 >nul",
    "cd /d \"%~dp0\"",
    "set \"SRC=%~dp0grok-desk.exe\"",
    "if not exist \"%SRC%\" if exist \"%~dp0grok-desk-new.exe\" set \"SRC=%~dp0grok-desk-new.exe\"",
    "if not exist \"%SRC%\" (",
    "  echo 还没有 GY Grok 程序。",
    "  pause",
    "  exit /b 1",
    ")",
    "set \"DEST=%LOCALAPPDATA%\\GY Grok\"",
    "mkdir \"%DEST%\" 2>nul",
    "copy /Y \"%SRC%\" \"%DEST%\\grok-desk.exe\" >nul",
    "if errorlevel 1 (",
    "  echo 无法复制到 %DEST%。请先关掉正在运行的 GY Grok。",
    "  pause",
    "  exit /b 1",
    ")",
    "powershell -NoProfile -ExecutionPolicy Bypass -Command \"$ws = New-Object -ComObject WScript.Shell; $desk = [Environment]::GetFolderPath('Desktop'); $s = $ws.CreateShortcut((Join-Path $desk 'GY Grok.lnk')); $s.TargetPath = Join-Path $env:LOCALAPPDATA 'GY Grok\\grok-desk.exe'; $s.WorkingDirectory = Join-Path $env:LOCALAPPDATA 'GY Grok'; $s.WindowStyle = 1; $s.Save()\"",
    "echo 已安装到 %DEST%",
    "echo 桌面快捷方式：GY Grok",
    "start \"\" \"%DEST%\\grok-desk.exe\"",
    "",
  ].join("\r\n"),
  "utf8",
);

writeFileSync(
  join(destDir, "使用说明.txt"),
  [
    "GY Grok",
    "",
    "这是本机跑的工作副本。",
    "",
    "！不要把这个 app 文件夹整个拷给别人。",
    "  跑过之后旁边会长出 grok-desk.exe.WebView2\\，那是浏览器档案，",
    "  里面有 Login Data、Cookies、History。拷过去等于把登录态一起给出去。",
    "",
    "  要发人请跑：node scripts\\pack-release.mjs",
    "  它只挑该带的文件，打成 dist-release\\GY-Grok-<版本>-win-x64.zip。",
    "",
    "第一次打开：",
    "  1. 双击「启动 Grok Desk.cmd」，或双击 grok-desk.exe",
    "  2. 软件会自己安装官方 Grok CLI（需要能访问 x.ai）",
    "  3. 电脑控制已经内置，不用再开后端",
    "  4. 点「连接账户」完成官方登录",
    "  5. 选一个项目文件夹就能开始",
    "",
    "想装到这台电脑：",
    "  双击「安装到这台电脑.cmd」",
    "  会放到 %LOCALAPPDATA%\\GY Grok，并在桌面建快捷方式 GY Grok",
    "",
    "别人需要：",
    "  Windows 10/11、能上网、有 Grok Build 订阅",
    "  不必先安装 grok，也不必先开命令行",
    "",
  ].join("\r\n"),
  "utf8",
);

console.log(`独立软件包已放到 ${destDir}（主程序 ${copiedTo}，${size} 字节）`);
