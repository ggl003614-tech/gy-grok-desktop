/**
 * 把发布包当成刚落到别人机器上的东西来验一遍。
 *
 * 跟 sandbox-new-user.mjs 的区别：那个测的是工作目录 app\，
 * 这个测的是 dist-release 里真正要发出去的 zip —— 解压到临时目录，
 * 用一套空白的 USERPROFILE / APPDATA / LOCALAPPDATA / PATH 启动，
 * 它就看不见这台机器上的 .grok、node、npm 和任何已装好的东西。
 *
 *   node scripts/sandbox-release.mjs
 *   node scripts/sandbox-release.mjs --audit-only    不启动窗口
 *   node scripts/sandbox-release.mjs --seconds 40
 */
import { execFileSync, spawn } from "node:child_process";
import {
  existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync,
  rmSync, statSync, writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const auditOnly = args.includes("--audit-only");
const keep = args.includes("--keep");
const secondsArg = args[args.indexOf("--seconds") + 1];
const waitSeconds = Math.max(15, Number(secondsArg) || 30);

const findings = [];
function say(level, title, detail) {
  findings.push({ level, title, detail });
  const tag = { ok: "通过", warn: "注意", fail: "不通过", info: "说明" }[level];
  console.log(`[${tag}] ${title}`);
  if (detail) console.log(`       ${detail}`);
}

function ps(cmd) {
  return execFileSync("powershell.exe",
    ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", cmd],
    { encoding: "utf8" }).trim();
}

function walk(dir, base = dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, e.name);
    if (e.isDirectory()) walk(full, base, out);
    else out.push(relative(base, full));
  }
  return out;
}

console.log("GY Grok 发布包 · 异地开机测试\n");

/* ── 0. 本机不能已经开着一份 ──
   单实例锁是 Local\GrokDesk.SingleInstance（见 src-tauri/src/instance.rs），
   作用域是整个 Windows 会话，跟 USERPROFILE 无关。已经开着一份的话，
   沙箱这份会立刻退出并把已有窗口拉到前台 —— 测出来是假的失败。 */
if (!auditOnly) {
  const running = ps(`
    (Get-Process -Name 'grok-desk' -ErrorAction SilentlyContinue | ForEach-Object { $_.Id }) -join ','
  `);
  if (running) {
    say("fail", "本机已经开着 GY Grok", `PID ${running}。单实例锁会让沙箱这份秒退，测不出东西。先关掉再跑`);
    console.log(`\n关掉它：  taskkill /PID ${running.split(",")[0]} /F`);
    process.exit(1);
  }
  say("ok", "本机没有其它 GY Grok 在跑", "单实例锁是空的，沙箱这份能真正起来");
}

/* ── 1. 找到 zip ── */
const distDir = join(root, "dist-release");
const zips = existsSync(distDir)
  ? readdirSync(distDir).filter((f) => f.endsWith(".zip"))
      .map((f) => ({ f, t: statSync(join(distDir, f)).mtimeMs }))
      .sort((a, b) => b.t - a.t)
  : [];
if (!zips.length) {
  say("fail", "没找到发布包", "先跑 node scripts/pack-release.mjs");
  process.exit(1);
}
const zip = join(distDir, zips[0].f);
say("ok", "找到发布包", `${zips[0].f} · ${(statSync(zip).size / 1048576).toFixed(2)} MB`);

/* ── 2. 解压到临时目录，模拟朋友收到之后解压 ── */
const box = mkdtempSync(join(tmpdir(), "gygrok-box-"));
const app = join(box, "app");
mkdirSync(app, { recursive: true });
ps(`Expand-Archive -Path '${zip}' -DestinationPath '${app}' -Force`);
const files = walk(app);
say("ok", "解压成功", `${files.length} 个文件：${files.join("、")}`);

const exe = join(app, "grok-desk.exe");
if (!existsSync(exe)) {
  say("fail", "包里没有 grok-desk.exe");
  process.exit(1);
}

/* ── 3. 包里不该有别人的东西 ── */
const dirty = files.filter((p) =>
  /\.WebView2|Login Data|Cookies|History|Web Data|Vpn Tokens|\.grok[\\/]/i.test(p));
if (dirty.length) {
  say("fail", "包里混进了档案文件", dirty.join("、"));
} else {
  say("ok", "包里没有登录态和浏览器档案", "对方拿到的是干净的，不会带上你的账号");
}

/* ── 4. 扫 exe 里有没有写死本机路径 ── */
const buf = readFileSync(exe);
const ascii = buf.toString("latin1");
const probes = [
  ["E:\\\\projects", "开发机的项目路径"],
  ["D:\\\\GY", "GY 工作室目录"],
  ["Users\\\\Administrator", "开发机的用户名"],
  ["C:\\\\Users\\\\Administrator", "开发机的用户目录"],
];
const leaks = probes.filter(([p]) => new RegExp(p, "i").test(ascii)).map(([p, why]) => `${p.replace(/\\\\/g, "\\")}（${why}）`);
if (leaks.length) {
  say("warn", "exe 里能扫到本机路径", `${leaks.join("、")}。多半是 Rust 的 panic 信息带的源码路径，不影响运行，但会暴露目录结构`);
} else {
  say("ok", "exe 里没有写死本机路径", "换台机器不会因为找不到 E:\\projects 之类的路径而崩");
}

/* ── 5. 对方机器上要有什么 ── */
const wv = ps(`
  $keys = @(
    'HKLM:\\SOFTWARE\\WOW6432Node\\Microsoft\\EdgeUpdate\\Clients\\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}',
    'HKLM:\\SOFTWARE\\Microsoft\\EdgeUpdate\\Clients\\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}'
  )
  foreach ($k in $keys) { if (Test-Path $k) { (Get-ItemProperty $k).pv; break } }
`);
if (wv) say("ok", "WebView2 运行时", `本机 ${wv}。Win10/11 一般自带；没有的话窗口起不来`);
else say("warn", "没查到 WebView2 运行时", "对方机器要是也没有，得先装 Evergreen Runtime");

try {
  const ver = ps(`(Invoke-WebRequest -UseBasicParsing -Uri 'https://x.ai/cli/stable' -TimeoutSec 15).Content.Trim()`);
  say("ok", "官方 CLI 通道可达", `https://x.ai/cli/stable → ${ver}。首次启动时软件自己去装，对方不用先装 grok`);
} catch {
  say("warn", "连不上 x.ai", "对方首次启动装不了 CLI。可能要挂代理");
}

/* ── 6. 空白环境启动 ── */
if (auditOnly) {
  say("info", "按 --audit-only 跳过启动");
} else {
  const home = join(box, "home");
  ["", "AppData", "AppData\\Local", "AppData\\Roaming", "Desktop", "Documents"]
    .forEach((p) => mkdirSync(join(home, p), { recursive: true }));

  // 只留系统目录。看不见 node、npm、grok，也看不见开发机的用户目录。
  const sysPath = [
    `${process.env.SystemRoot}\\system32`,
    process.env.SystemRoot,
    `${process.env.SystemRoot}\\system32\\Wbem`,
  ].join(";");
  const env = {
    SystemRoot: process.env.SystemRoot,
    windir: process.env.windir,
    SystemDrive: process.env.SystemDrive,
    ComSpec: process.env.ComSpec,
    NUMBER_OF_PROCESSORS: process.env.NUMBER_OF_PROCESSORS,
    PROCESSOR_ARCHITECTURE: process.env.PROCESSOR_ARCHITECTURE,
    PATH: sysPath,
    Path: sysPath,
    USERPROFILE: home,
    HOMEDRIVE: home.slice(0, 2),
    HOMEPATH: home.slice(2),
    APPDATA: join(home, "AppData", "Roaming"),
    LOCALAPPDATA: join(home, "AppData", "Local"),
    TEMP: join(home, "AppData", "Local", "Temp"),
    TMP: join(home, "AppData", "Local", "Temp"),
    USERNAME: "sandboxuser",
  };
  mkdirSync(env.TEMP, { recursive: true });

  say("info", "空白环境启动中", `USERPROFILE=${home}，PATH 只留系统目录，${waitSeconds} 秒后收工`);
  const child = spawn(exe, [], { env, cwd: app, detached: false, stdio: ["ignore", "pipe", "pipe"] });
  let out = "";
  child.stdout.on("data", (d) => { out += d; });
  child.stderr.on("data", (d) => { out += d; });
  let exited = null;
  child.on("exit", (code) => { exited = code; });

  await new Promise((r) => setTimeout(r, waitSeconds * 1000));

  if (exited !== null) {
    say("fail", `进程退出了，code=${exited}`, out.slice(0, 600) || "（没有输出）");
  } else {
    say("ok", "窗口起来了并且活着", `空白环境跑满 ${waitSeconds} 秒没崩`);

    const port = ps(`
      try { (Get-NetTCPConnection -LocalPort 18765 -State Listen -ErrorAction Stop | Select-Object -First 1).OwningProcess }
      catch { '' }
    `);
    if (port) say("ok", "电脑控制自己起来了", `127.0.0.1:18765 在监听，PID ${port}。对方不用另开后端`);
    else say("warn", "18765 没在监听", "可能是本机已有一份 GY Grok 占着端口，也可能这一版没自动开");

    /* 凭据路径到底跟不跟 USERPROFILE 走。
       别去比真实 .grok 的 mtime —— 开发机上常年挂着 grok CLI 进程，
       它自己一直在写 active_sessions.json 和 unified.jsonl，比出来全是噪音。
       要看的是正面证据：沙箱这份有没有在空白 home 里自己建一套。 */
    const made = walk(home).filter((p) => !p.startsWith("AppData\\Local\\Temp"));
    const ownGrok = made.filter((p) => p.startsWith(".grok\\"));
    if (ownGrok.length) {
      say("ok", "凭据路径跟着 USERPROFILE 走",
        `在空白 home 里自己建了 .grok，${ownGrok.length} 个文件。换台机器不会去翻别人的目录`);
    } else if (made.length) {
      say("warn", "写了配置但没建 .grok",
        `${made.length} 个文件，比如 ${made.slice(0, 4).join("、")}。可能还没走到装 CLI 那一步`);
    } else {
      say("warn", "空白档案里什么都没写", "可能还没走到写配置那一步，也可能路径没跟着 USERPROFILE 走");
    }
  }

  try { child.kill(); } catch {}
  try {
    execFileSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore" });
  } catch {
    /* 进程可能已经自己退了，taskkill 会报 128，不是问题 */
  }
}

/* ── 收尾 ── */
const bad = findings.filter((f) => f.level === "fail");
const warn = findings.filter((f) => f.level === "warn");
console.log(`\n${"-".repeat(56)}`);
console.log(`不通过 ${bad.length} · 注意 ${warn.length} · 通过 ${findings.filter((f) => f.level === "ok").length}`);

const reportDir = join(root, ".sandbox-release");
mkdirSync(reportDir, { recursive: true });
writeFileSync(join(reportDir, "last-report.json"),
  JSON.stringify({ at: new Date().toISOString(), zip: zips[0].f, findings }, null, 2), "utf8");
console.log(`报告：${join(reportDir, "last-report.json")}`);

if (keep) console.log(`临时环境留着了：${box}`);
else rmSync(box, { recursive: true, force: true });

process.exit(bad.length ? 1 : 0);
