/**
 * 把 tauri build 出来的安装包整理成能直接发给别人的东西。
 *
 * 跟 pack-release.mjs 的区别：那个出免安装的 zip（解压即用），
 * 这个出 NSIS 安装程序（双击装到电脑里、建开始菜单和桌面快捷方式）。
 *
 *   npx tauri build          先出安装包
 *   node scripts/pack-installer.mjs
 */
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const conf = JSON.parse(readFileSync(join(root, "src-tauri", "tauri.conf.json"), "utf8"));
const version = conf.version;

const bundleDir = join(root, "src-tauri", "target", "release", "bundle");
const nsisDir = join(bundleDir, "nsis");
const distDir = join(root, "dist-release");

if (!existsSync(nsisDir)) {
  console.error("没找到安装包。先跑：npx tauri build");
  process.exit(1);
}
const found = readdirSync(nsisDir).filter((f) => f.endsWith(".exe"));
if (!found.length) {
  console.error("nsis 目录里没有 .exe。先跑：npx tauri build");
  process.exit(1);
}

// 按版本号精确挑，不能用 found[0] —— nsis 目录里旧版本不会自动清掉，
// 按字母序 0.1.0 排在 0.2.0 前面，取第一个就会把旧版打成新版发出去。
const wanted = found.filter((name) => name.includes(`_${version}_`));
if (wanted.length !== 1) {
  console.error(
    `nsis 目录里没有恰好一个 ${version} 的安装包（找到 ${wanted.length} 个）。` +
    `
目录内容：${found.join(", ")}` +
    `
先跑：npx tauri build`,
  );
  process.exit(1);
}
const src = join(nsisDir, wanted[0]);
const outName = `GY-Grok-${version}-Setup.exe`;
mkdirSync(distDir, { recursive: true });
const dest = join(distDir, outName);
rmSync(dest, { force: true });
copyFileSync(src, dest);

const size = statSync(dest).size;
const hash = createHash("sha256").update(readFileSync(dest)).digest("hex");
writeFileSync(join(distDir, `${outName}.sha256`), `${hash}  ${outName}\r\n`, "utf8");

/* 给收件人的说明。装之前会遇到什么、装完在哪，都写清楚。 */
writeFileSync(join(distDir, "安装说明.txt"), [
  `GY Grok  v${version}`,
  "",
  "给 Grok Build 用的 Windows 图形界面。社区项目，不是 xAI 官方出的。",
  "",
  "怎么装",
  `  双击 ${outName}，按提示下一步就行。`,
  "  装完开始菜单和桌面都会有「GY Grok」。",
  "",
  "Windows 会拦一下",
  "  安装包没有商业代码签名证书，SmartScreen 会弹「已保护你的电脑」。",
  "  点「更多信息」→「仍要运行」。",
  "  不放心的话，先在 PowerShell 里核对校验值：",
  `      Get-FileHash .\${outName} -Algorithm SHA256`,
  `  应该等于：${hash}`,
  "",
  "第一次打开",
  "  软件检测到你这台机器没有 grok，会自己去官网装官方 CLI，不用你动手。",
  "  只认 x.ai 官方地址，别的来源一律拒绝。",
  "  这一步要下 142 MB，装完在 %USERPROFILE%\.grok 下占大约 430 MB。",
  "  安装包才 4 MB，别被骗了 —— 大头是官方 CLI，不是这个界面。",
  "  装完点「连接账户」走官方登录，选一个项目文件夹就能用。",
  "",
  "你需要有什么",
  "  Windows 10 或 11，64 位。WebView2 一般系统自带。",
  "  能上网。",
  "  一个有 Grok Build 权限的 Grok / X 账号。没有的话窗口会明说。",
  "",
  "你的数据放在哪",
  "  登录凭据和会话在 %USERPROFILE%\.grok，归官方 CLI 管。",
  "  软件自己的设置在 %LOCALAPPDATA%\dev.grokdesk.desktop。",
  "  这个安装包里不含任何账号信息。",
  "",
  "源码",
  "  https://github.com/ggl003614-tech/gy-grok-desktop",
  "",
].join("\r\n"), "utf8");
// 加 BOM：Windows 记事本没有 BOM 时按系统 ANSI 码页读，中文会变乱码。
// 收件人双击打开看到的第一眼就是这个文件，不能让它糊掉。
const noticePath = join(distDir, "安装说明.txt");
writeFileSync(noticePath, Buffer.concat([
  Buffer.from([0xef, 0xbb, 0xbf]),
  readFileSync(noticePath),
]));

console.log(`GY Grok v${version} 安装包\n`);
console.log(`  ${dest}`);
console.log(`  ${(size / 1048576).toFixed(2)} MB`);
console.log(`  SHA-256  ${hash}`);
console.log(`\n同目录还有 安装说明.txt 和 ${outName}.sha256`);
console.log(`发给朋友：把这两个文件一起发过去。`);
