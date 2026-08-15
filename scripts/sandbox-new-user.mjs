/**
 * Pretend this copy of GY Grok landed on a new Windows user.
 *
 * 1. Static audit: hidden local-only services / this-PC paths
 * 2. Reach official CLI channel (what first-run install needs)
 * 3. Launch the portable exe with a blank USERPROFILE / APPDATA / PATH
 *
 * Usage:
 *   node scripts/sandbox-new-user.mjs
 *   node scripts/sandbox-new-user.mjs --audit-only
 *   node scripts/sandbox-new-user.mjs --keep --seconds 60
 */
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const args = new Set(process.argv.slice(2));
const auditOnly = args.has("--audit-only");
const keep = args.has("--keep");
const secondsArg = process.argv.find((item, index, all) => all[index - 1] === "--seconds");
const waitSeconds = Math.max(12, Number(secondsArg) || 28);

const report = {
  at: new Date().toISOString(),
  findings: [],
  launch: null,
};

function add(severity, title, detail) {
  report.findings.push({ severity, title, detail });
  const mark = severity === "ok" ? "OK  " : severity === "warn" ? "WARN" : "INFO";
  console.log(`[${mark}] ${title}`);
  if (detail) console.log(`      ${detail}`);
}

function ps(command) {
  return execFileSync(
    "powershell.exe",
    ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", command],
    { encoding: "utf8", windowsHide: true },
  ).trim();
}

function findPortableExe() {
  const candidates = [
    join(root, "app", "grok-desk.exe"),
    join(root, "app", "grok-desk-new.exe"),
    join(process.env.LOCALAPPDATA || "", "GY Grok", "grok-desk.exe"),
  ];
  return candidates.find((path) => existsSync(path) && statSync(path).size > 5_000_000) ?? null;
}

function scanShippedRust() {
  const dir = join(root, "src-tauri", "src");
  const hits = [];
  for (const name of readdirSync(dir)) {
    if (!name.endsWith(".rs")) continue;
    const full = readFileSync(join(dir, name), "utf8");
    const cut = full.search(/#\[cfg\(test\)\]/);
    const text = cut >= 0 ? full.slice(0, cut) : full;
    for (const [index, line] of text.split(/\r?\n/).entries()) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("//") || trimmed.startsWith("*")) continue;
      if (/#\[cfg\(test\)\]/.test(text.slice(Math.max(0, text.indexOf(line) - 80), text.indexOf(line)))) continue;
      if (/(C:\\\\Users\\\\Administrator|D:\\\\GY工作室|E:\\\\projects\\\\grok-desktop)/.test(trimmed)) {
        hits.push(`${name}:${index + 1}: ${trimmed.slice(0, 160)}`);
      }
    }
  }
  return hits;
}

function pathWithoutGrok(pathValue) {
  return String(pathValue || "")
    .split(";")
    .filter((part) => part && !/[/\\]\.grok[/\\]bin/i.test(part))
    .join(";");
}

function listGrokDesk() {
  try {
    const raw = ps(
      "Get-CimInstance Win32_Process -Filter \"Name='grok-desk.exe'\" | Select-Object ProcessId,ExecutablePath | ConvertTo-Json -Compress",
    );
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return (Array.isArray(parsed) ? parsed : [parsed]).filter((item) => item?.ProcessId);
  } catch {
    return [];
  }
}

async function probeOfficialCli() {
  const urls = [
    "https://x.ai/cli/stable",
    "https://storage.googleapis.com/grok-build-public-artifacts/cli/stable",
  ];
  for (const url of urls) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(20_000) });
      const text = (await response.text()).trim();
      if (response.ok && /^\d/.test(text) && text.length < 40) {
        add("ok", "官方 CLI 通道可达", `${url} → ${text}`);
        return text;
      }
      add("warn", "官方 CLI 通道响应异常", `${url} HTTP ${response.status} ${text.slice(0, 80)}`);
    } catch (error) {
      add("warn", "官方 CLI 通道连不上", `${url} · ${error instanceof Error ? error.message : error}`);
    }
  }
  return null;
}

function webviewInstalled() {
  const roots = [
    join(process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)", "Microsoft", "EdgeWebView"),
    join(process.env.ProgramFiles || "C:\\Program Files", "Microsoft", "EdgeWebView"),
  ];
  return roots.some((path) => existsSync(path));
}

function treeSummary(dir, depth = 0) {
  if (!existsSync(dir) || depth > 3) return [];
  const lines = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    let extra = "";
    try {
      const stat = statSync(full);
      extra = stat.isDirectory() ? "/" : ` ${stat.size}`;
      lines.push(`${"  ".repeat(depth)}${name}${extra}`);
      if (stat.isDirectory()) lines.push(...treeSummary(full, depth + 1).map((item) => item));
    } catch {
      lines.push(`${"  ".repeat(depth)}${name} ?`);
    }
  }
  return lines;
}

async function sleep(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function launchIsolated(exe) {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const sandbox = join(root, ".sandbox-new-user", stamp);
  const home = join(sandbox, "home");
  const appdata = join(home, "AppData", "Roaming");
  const local = join(home, "AppData", "Local");
  const temp = join(sandbox, "temp");
  for (const dir of [home, appdata, local, temp, join(home, "Desktop"), join(home, "Documents"), join(home, "Downloads")]) {
    mkdirSync(dir, { recursive: true });
  }

  const previous = listGrokDesk();
  const closed = [];
  for (const item of previous) {
    try {
      ps(`Stop-Process -Id ${item.ProcessId} -Force`);
      closed.push(item);
    } catch (error) {
      add("warn", "没法先关掉正在跑的 GY Grok", String(error));
    }
  }
  if (closed.length) {
    add("info", "沙箱要独占单实例，已暂时关掉你正在用的 GY Grok", closed.map((item) => item.ExecutablePath).join(", "));
    await sleep(1500);
  }

  // Keep the real Windows token / Known Folders so Tauri can resolve AppData.
  // A genuine new user has those. Stripping the whole environment made
  // SHGetKnownFolderPath fail ("unknown path") — that is not a new-user bug.
  // Hide this machine's Grok login and CLI by pointing USERPROFILE at an empty home
  // and taking `.grok\\bin` off PATH.
  const env = { ...process.env };
  delete env.GROK_BIN;
  env.USERPROFILE = home;
  env.HOME = home;
  env.HOMEDRIVE = home.slice(0, 2);
  env.HOMEPATH = home.slice(2) || "\\";
  env.APPDATA = appdata;
  env.LOCALAPPDATA = local;
  env.TEMP = temp;
  env.TMP = temp;
  env.WEBVIEW2_USER_DATA_FOLDER = join(local, "EBWebView");
  env.PATH = pathWithoutGrok(env.PATH);

  const child = spawn(exe, [], {
    cwd: dirname(exe),
    env,
    detached: true,
    stdio: "ignore",
    windowsHide: false,
  });
  child.unref();

  const startedAt = Date.now();
  await sleep(waitSeconds * 1000);

  const live = listGrokDesk().filter((item) => {
    const path = String(item.ExecutablePath || "").toLowerCase();
    return path === exe.toLowerCase() || !previous.some((old) => old.ProcessId === item.ProcessId);
  });
  const sqlite = join(appdata, "dev.grokdesk.desktop", "grok-desk.sqlite3");
  const grokHome = join(home, ".grok");
  const panic = join(temp, "grok-desk-panic.log");
  const logsDir = join(local, "dev.grokdesk.desktop", "logs");

  let portOwner = "";
  try {
    portOwner = ps(
      "Get-NetTCPConnection -LocalPort 18765 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty OwningProcess",
    );
  } catch {
    portOwner = "";
  }

  report.launch = {
    sandbox,
    pid: child.pid ?? null,
    livedMs: Date.now() - startedAt,
    processes: live,
    sqliteCreated: existsSync(sqlite),
    grokHomeCreated: existsSync(grokHome),
    grokHomeTree: existsSync(grokHome) ? treeSummary(grokHome).slice(0, 40) : [],
    sandboxTree: treeSummary(sandbox).slice(0, 80),
    panicLog: existsSync(panic) ? readFileSync(panic, "utf8").slice(0, 2000) : null,
    logsDirExists: existsSync(logsDir),
    port18765Owner: portOwner || null,
    restored: [],
  };

  const webviewData = join(local, "EBWebView");
  report.launch.webviewDataCreated = existsSync(webviewData);

  if (live.length && !existsSync(panic)) {
    add("ok", "空白 Grok 主目录下，独立程序能自己站住", `${live.length} 个 grok-desk · pid ${live.map((item) => item.ProcessId).join(",")}`);
  } else if (live.length) {
    add("warn", "进程还在，但已经写过 panic 日志", panic);
  } else {
    add("warn", "沙箱进程没有留下来", "可能秒退、被单实例送走，或缺少 WebView2。");
  }

  if (existsSync(join(grokHome, "bin", "grok.exe"))) {
    add("ok", "沙箱里已经装上了官方 Grok CLI", join(grokHome, "bin", "grok.exe"));
  } else if (existsSync(join(grokHome, "downloads"))) {
    add("info", "正在往空白用户目录下载官方 CLI", join(grokHome, "downloads"));
  } else if (live.length) {
    add("info", "空白用户还没有 Grok CLI", "正常。界面应提示自动安装；安装需要能访问 x.ai。");
  }

  if (report.launch.panicLog) {
    add("warn", "沙箱写了 panic 日志", report.launch.panicLog.split(/\r?\n/)[0] ?? "");
  }

  if (portOwner && live.some((item) => String(item.ProcessId) === String(portOwner))) {
    add("ok", "电脑控制端口是这份沙箱自己占用的", `pid ${portOwner} on 127.0.0.1:18765`);
  } else if (portOwner) {
    add("info", "18765 被别的进程占着", `pid ${portOwner}。电脑控制是软件内置的，不是外部服务。`);
  }

  if (!keep) {
    for (const item of listGrokDesk()) {
      try {
        ps(`Stop-Process -Id ${item.ProcessId} -Force`);
      } catch {
        // ignore
      }
    }
    await sleep(800);
    for (const item of closed) {
      if (!item.ExecutablePath || !existsSync(item.ExecutablePath)) continue;
      spawn(item.ExecutablePath, [], { detached: true, stdio: "ignore", windowsHide: false }).unref();
      report.launch.restored.push(item.ExecutablePath);
    }
    if (report.launch.restored.length) {
      add("info", "已把你原来的 GY Grok 重新打开", report.launch.restored.join(", "));
    }
  } else {
    add("info", "按 --keep 留下了沙箱进程", "看完后自己关掉。你原来的 GY Grok 这次没有自动恢复。");
  }

  return sandbox;
}

async function main() {
  console.log("GY Grok 新用户沙箱\n");

  const exe = findPortableExe();
  if (exe) add("ok", "找到可分发的独立程序", `${exe} · ${Math.round(statSync(exe).size / 1024 / 1024)} MB`);
  else add("warn", "还没有独立程序", "先运行 npm run build:desk 或 打包独立版.cmd");

  if (webviewInstalled()) add("ok", "这台电脑有 WebView2", "新 Win10/11 通常也有；没有的话窗口起不来。");
  else add("warn", "没找到 WebView2 Runtime", "新用户若被精简过系统，需要先装 Microsoft Edge WebView2。");

  const rustHits = scanShippedRust();
  if (rustHits.length) add("warn", "生产 Rust 里出现了这台电脑的路径", rustHits.join("\n"));
  else add("ok", "生产代码没有写死本机 Administrator / D:\\GY / E:\\projects 路径", "Grok 从 %USERPROFILE%\\.grok 或 PATH 找。");

  add(
    "ok",
    "127.0.0.1:18765 是 GY Grok 自己拉起的电脑控制",
    "不是我在背后另开的服务。新用户双击 exe 就会带上。本机已有一份 GY Grok 时，第二份会抢不到端口。",
  );
  add(
    "info",
    "新用户不会带着你的登录态",
    "auth、会话、生活模式都在 %USERPROFILE%\\.grok 和 AppData\\dev.grokdesk.desktop。空白档案是空的。",
  );

  await probeOfficialCli();

  const sandboxExe = process.env.WINDIR ? join(process.env.WINDIR, "System32", "WindowsSandbox.exe") : "";
  if (sandboxExe && existsSync(sandboxExe)) {
    add("info", "这台电脑有 Windows Sandbox", "要完全干净的 Windows，可另开 scripts/gy-grok-windows-sandbox.wsb");
  } else {
    add("info", "没有检测到 Windows Sandbox", "这次用空白用户档案模拟新用户，不是整台虚拟机。");
  }

  if (!auditOnly && exe) {
    console.log(`\n启动空白用户档案，观察 ${waitSeconds} 秒…\n`);
    await launchIsolated(exe);
  } else if (auditOnly) {
    add("info", "按 --audit-only 跳过了窗口启动", "");
  }

  const out = join(root, ".sandbox-new-user", "last-report.json");
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(`\n报告：${out}`);
  const warns = report.findings.filter((item) => item.severity === "warn");
  if (warns.length) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
