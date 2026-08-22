import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = dirname(fileURLToPath(import.meta.url));

// 删除线程是三层一起清：远端会话、本地记录、后台快照。
// 这组断言钉住接线，防止哪天有人只删了一层。
describe("thread deletion surface", () => {
  const app = readFileSync(join(root, "App.tsx"), "utf8");
  const sidebar = readFileSync(join(root, "Sidebar.tsx"), "utf8");
  const i18n = readFileSync(join(root, "i18n.ts"), "utf8");
  const css = readFileSync(join(root, "App.css"), "utf8");

  it("三层都删：远端 + 本地记录 + 快照", () => {
    expect(app).toMatch(/client\.deleteSession\(sessionId\)/);
    expect(app).toMatch(/delete_grok_session/);
    expect(app).toMatch(/delete_local_session/);
    expect(app).toMatch(/const deleteThread = async/);
  });

  it("正在跑的先停再删", () => {
    const fn = app.slice(app.indexOf("const deleteThread"), app.indexOf("const cancelThread"));
    expect(fn.indexOf("client.cancel")).toBeGreaterThan(-1);
    expect(fn.indexOf("client.cancel")).toBeLessThan(fn.indexOf("deleteSession"));
  });

  it("删的是当前线程时回到空状态，不停留在已删除的会话上", () => {
    const fn = app.slice(app.indexOf("const deleteThread"), app.indexOf("const cancelThread"));
    expect(fn).toMatch(/setDraftConversation\(true\)/);
    expect(fn).toMatch(/setLocalSessionId\(""\)/);
  });

  it("侧栏有垃圾桶入口和行内确认态", () => {
    expect(sidebar).toMatch(/tree-delete-btn/);
    expect(sidebar).toMatch(/confirmingId/);
    expect(sidebar).toMatch(/onDeleteThread/);
    expect(sidebar).toMatch(/setConfirmingId\(""\)/);
  });

  it("中英文文案都在", () => {
    for (const key of ["sidebar.delete", "sidebar.deleteConfirm", "sidebar.deleted"]) {
      expect(i18n.split('"' + key + '"').length - 1).toBe(2);
    }
  });

  it("样式在，删除是危险色", () => {
    expect(css).toMatch(/\.tree-delete-btn/);
    expect(css).toMatch(/\.tree-confirm/);
  });
});

describe("界面细节修复（回归防线）", () => {
  const app = readFileSync(join(root, "App.tsx"), "utf8");
  const settings = readFileSync(join(root, "SettingsPanel.tsx"), "utf8");
  const i18n = readFileSync(join(root, "i18n.ts"), "utf8");
  const css = readFileSync(join(root, "App.css"), "utf8");
  const index = readFileSync(join(root, "index.css"), "utf8");

  it("路径占位符不带双反斜杠", () => {
    // JSX 属性里的字符串不处理转义，写成 "C:\\path" 会原样显示两道斜杠。
    // 用字符串比较而不是正则 —— 正则里 \p、\t 会被当成转义序列。
    const backslash = String.fromCharCode(92);
    const quote = String.fromCharCode(34);
    expect(app.includes("placeholder=" + quote + "C:" + backslash + backslash + "path")).toBe(false);
    expect(
      app.includes(
        "String.raw`C:" + backslash + "path" + backslash + "to" + backslash + "project`",
      ),
    ).toBe(true);
  });

  it("装不上时不再把同一句话说三遍", () => {
    // 红框副标题固定给「怎么办」，原始报错单独一行且可能不出现
    expect(app).toMatch(/<span>\{t\("welcome\.missingHint"\)\}<\/span>/);
    expect(app).toMatch(/setup-detail/);
    // 标题栏的兜底状态换成短句，跟红框标题不再同义
    expect(app).not.toMatch(/未能安装官方 Grok Build/);
  });

  it("检查更新接了后端命令，并且不跟 Grok CLI 的更新混淆", () => {
    expect(settings).toMatch(/invoke<UpdateCheck>\("check_app_update"\)/);
    for (const key of ["settings.checkUpdate", "settings.updateLatest", "settings.updateFound"]) {
      expect(i18n.split('"' + key + '"').length - 1).toBe(2);
    }
  });

  it("模型和目标用了各自的图标，不再共用 Sparkles", () => {
    // 模型下拉换成了自定义的 QuietSelect，图标当 prop 传进去
    expect(app).toMatch(/icon=\{<Sparkles size=\{14\} \/>\}/);
    expect(app).toMatch(/<Target size=\{12\} \/>/);
  });

  it("输入栏不再用原生 select —— 系统弹层跟界面不是一套东西", () => {
    const composer = app.slice(app.indexOf('className="composer-bottom"'), app.indexOf("send-button"));
    expect(composer).not.toMatch(/<select/);
    expect(composer).toMatch(/<QuietSelect/);
  });

  it("下拉菜单 portal 到 body —— 留在原地会被 overflow:hidden 裁掉", () => {
    // 真出过的 bug：.model-controls 上有 overflow: hidden，菜单作为它的后代
    // 被整个裁掉，点了有反应但什么都看不见，表现得像按钮失灵。
    const quiet = readFileSync(join(root, "QuietSelect.tsx"), "utf8");
    expect(quiet).toMatch(/createPortal\(/);
    expect(quiet).toMatch(/document\.body/);
    // portal 出去之后必须自己定位，absolute 会相对 body 而不是按钮
    expect(css).toMatch(/\.quiet-menu\s*\{[^}]*position: fixed/);
  });

  it("聚焦时靠淡环表示，不把边框拉到近黑色", () => {
    expect(css).toMatch(/--focus-ring/);
    expect(css).not.toMatch(/\.composer:focus-within \{ border-color: var\(--text-2\); \}/);
    // 亮色和暗色两套都要有，否则一套下面变量是空的
    expect(index.split("--focus-line").length - 1).toBeGreaterThanOrEqual(2);
    expect(index.split("--focus-ring").length - 1).toBeGreaterThanOrEqual(2);
  });
});
