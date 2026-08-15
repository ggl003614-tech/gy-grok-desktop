/**
 * 打一个能发给别人的干净包。
 *
 * 跟 copy-desk.mjs 的区别：copy-desk 只是把 exe 拷进 app\ 供本机跑，
 * app\ 跑过之后会长出 grok-desk.exe.WebView2\ —— 那是 WebView2 的浏览器
 * 档案，里面有 Login Data / History / Web Data / Network\Cookies。
 * 直接把 app\ 打包发人 = 把自己的登录态一起发出去。
 *
 * 这个脚本只往干净的暂存目录里放白名单文件，打包前再扫一遍，
 * 发现任何档案残留就直接失败，不让它出门。
 *
 *   node scripts/pack-release.mjs
 *   node scripts/pack-release.mjs --no-zip     只出目录不压缩
 */
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync,
  rmSync, statSync, writeFileSync,
} from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const args = new Set(process.argv.slice(2));
const noZip = args.has("--no-zip");

const conf = JSON.parse(readFileSync(join(root, "src-tauri", "tauri.conf.json"), "utf8"));
const version = conf.version;
const name = `GY-Grok-${version}-win-x64`;

const srcApp = join(root, "app");
const distDir = join(root, "dist-release");
const stage = join(distDir, name);

/* 只有这几样能进包。别的一律不带。 */
const ALLOW = [
  { from: "grok-desk.exe", required: true },
  { from: "启动 Grok Desk.cmd", required: true },
  { from: "安装到这台电脑.cmd", required: true },
  { from: "生活模式演示.html", required: false },
];

/* 出门前必须扫干净的东西。命中就中止。 */
const FORBID = [
  { test: (p) => /\.WebView2(\\|\/|$)/i.test(p), why: "WebView2 浏览器档案（登录态、Cookie、历史）" },
  { test: (p) => /(^|[\\/])\.grok([\\/]|$)/i.test(p), why: "Grok CLI 的凭据目录" },
  { test: (p) => /(^|[\\/])(Login Data|Cookies|History|Web Data|Vpn Tokens)$/i.test(p), why: "浏览器凭据/历史文件" },
  { test: (p) => /\.(pdb|log|env)$/i.test(p), why: "调试符号 / 日志 / 环境变量" },
  { test: (p) => /grok-desk-new\.exe$/i.test(p), why: "上次没覆盖成功的临时 exe" },
];

function sha256(file) {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

function walk(dir, base = dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full, base, out);
    else out.push(relative(base, full));
  }
  return out;
}

console.log(`GY Grok 发布包  v${version}\n`);

/* ── 1. 先看看源目录里有没有不该带的东西（只是提醒，不拷就没事） ── */
if (existsSync(srcApp)) {
  const dirty = walk(srcApp).filter((p) => FORBID.some((r) => r.test(p)));
  if (dirty.length) {
    const bytes = dirty.reduce((n, p) => n + statSync(join(srcApp, p)).size, 0);
    console.log(`[注意] app\\ 里有 ${dirty.length} 个文件不该发出去（${(bytes / 1048576).toFixed(1)} MB）`);
    console.log(`       主要是 WebView2 档案。这个脚本不会拷它们，但你要是手动压缩 app\\ 就会带上。\n`);
  }
}

/* ── 2. 白名单拷贝到干净暂存目录 ── */
rmSync(stage, { recursive: true, force: true });
mkdirSync(stage, { recursive: true });

for (const item of ALLOW) {
  const from = join(srcApp, item.from);
  if (!existsSync(from)) {
    if (item.required) {
      console.error(`\n缺少 ${item.from}。先跑 npm run build:desk。`);
      process.exit(1);
    }
    console.log(`[跳过] ${item.from}（可选，没找到）`);
    continue;
  }
  copyFileSync(from, join(stage, item.from));
  console.log(`[带上] ${item.from}  ${(statSync(from).size / 1048576).toFixed(2)} MB`);
}

const exe = join(stage, "grok-desk.exe");
const exeSize = statSync(exe).size;
if (exeSize < 10_000_000) {
  console.error(`\ngrok-desk.exe 只有 ${exeSize} 字节，明显不对。请用 npm run build:desk。`);
  process.exit(1);
}

/* ── 3. 写给收件人看的说明。别再说「把整个 app 文件夹拷过去」 ── */
writeFileSync(join(stage, "使用说明.txt"), [
  `GY Grok  v${version}`,
  "",
  "给 Grok Build 用的 Windows 图形界面。社区项目，不是 xAI 官方出的。",
  "",
  "怎么打开",
  "  双击「启动 Grok Desk.cmd」，或者直接双击 grok-desk.exe。",
  "  装完点「连接账户」走官方登录，选一个项目文件夹就能用。",
  "",
  "第一次打开会自己装官方 CLI",
  "  软件检测到你这台机器没有 grok，会直接去官网下载安装，不用你动手。",
  "  只认 x.ai 官方地址，别的来源一律拒绝。",
  "",
  "  这一步要下 142 MB，装完在 %USERPROFILE%\\.grok 下占大约 430 MB。",
  "  这个包才 5 MB，别被骗了 —— 真正的大头是官方 CLI，不是这个界面。",
  "  网络不通的话软件会明说，不会卡着不动。",
  "",
  "想装到这台电脑",
  "  双击「安装到这台电脑.cmd」。",
  "  程序会放到 %LOCALAPPDATA%\\GY Grok，桌面上建一个叫 GY Grok 的快捷方式。",
  "",
  "你需要有什么",
  "  Windows 10 或 11，64 位。WebView2 一般系统自带。",
  "  能上网。",
  "  一个有 Grok Build 权限的 Grok / X 账号。没有的话窗口会明说。",
  "  不用先装 grok，也不用先开命令行。",
  "",
  "你的数据放在哪",
  "  登录凭据和会话在 %USERPROFILE%\\.grok，归官方 CLI 管。",
  "  软件自己的设置在 %LOCALAPPDATA%\\dev.grokdesk.desktop。",
  "  这个包里不含任何账号信息，是干净的。",
  "",
  "Windows 可能拦一下",
  "  安装包没有商业签名，SmartScreen 可能弹「已保护你的电脑」。",
  "  点「更多信息」→「仍要运行」。不放心的话先核对下面的校验值。",
  "",
].join("\r\n"), "utf8");
console.log(`[写入] 使用说明.txt`);

/* ── 4. 出门前再扫一遍暂存目录 ── */
const staged = walk(stage);
const leaked = [];
for (const p of staged) {
  const hit = FORBID.find((r) => r.test(p));
  if (hit) leaked.push(`${p}  —— ${hit.why}`);
}
if (leaked.length) {
  console.error("\n打包中止：暂存目录里混进了不该发的东西\n");
  leaked.forEach((l) => console.error("  " + l));
  process.exit(1);
}
console.log(`\n[检查] ${staged.length} 个文件，没有档案残留`);

/* ── 5. 校验值 ── */
const exeHash = sha256(exe);
const lines = [
  `GY Grok v${version}`,
  "",
  `grok-desk.exe`,
  `  SHA-256  ${exeHash}`,
  `  大小     ${exeSize} 字节`,
  "",
  "在 PowerShell 里自己核一遍：",
  `  Get-FileHash .\\grok-desk.exe -Algorithm SHA256`,
  "",
];
writeFileSync(join(stage, "校验值.txt"), lines.join("\r\n"), "utf8");
console.log(`[写入] 校验值.txt`);
console.log(`       exe SHA-256  ${exeHash}`);

/* ── 6. 压缩 ── */
if (noZip) {
  console.log(`\n目录已出：${stage}`);
  process.exit(0);
}
const zip = join(distDir, `${name}.zip`);
rmSync(zip, { force: true });
execFileSync("powershell.exe", [
  "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command",
  `Compress-Archive -Path '${stage}\\*' -DestinationPath '${zip}' -CompressionLevel Optimal`,
], { stdio: "inherit" });

const zipSize = statSync(zip).size;
const zipHash = sha256(zip);
writeFileSync(join(distDir, `${name}.zip.sha256`), `${zipHash}  ${name}.zip\r\n`, "utf8");

console.log(`\n发布包：${zip}`);
console.log(`  ${(zipSize / 1048576).toFixed(2)} MB`);
console.log(`  SHA-256  ${zipHash}`);
console.log(`\n发给朋友：把这个 zip 发过去，让他解压后双击「启动 Grok Desk.cmd」。`);
console.log(`验证一下能不能在别人机器上跑：node scripts/sandbox-release.mjs`);
