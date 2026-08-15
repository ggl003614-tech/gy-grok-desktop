# GY Grok

[English](README.md) · [中文](README.zh-CN.md)

面向 Windows 的 [Grok Build](https://x.ai) 非官方桌面客户端。它通过官方
`grok agent stdio` 的 ACP v1 接口工作，同时嵌了一整块 ConPTY 终端，
官方 CLI 出什么新功能都还能直接用。

> 社区项目，与 xAI、X 或 SpaceX 没有隶属或背书关系。「Grok」及相关标识归其权利人所有。
> GY Grok 不提供、转售或绕过任何订阅。

![GY Grok 欢迎页](docs/images/grok-desk-welcome.jpg)

---

## 别处大概没有的那部分

**生活模式。** Grok Build 没有 5 小时限制。没有东西会拦你，所以你可能一整天都在工作，
自己都没发现，等发现的时候一周的额度已经烧掉一大半了。

现在大家都在关注 AI 的安全，却没有人去关注人类的安全。所以这个客户端让你给**自己**
设一个上限：

- 定一个每天最多用掉本期额度的百分比，比如 20%。用到这个数，整个窗口就锁住。
- 可以再划时段。只有九点到十八点能用，别的时间锁着。最多六段，每段单独设百分比。
- 什么时候重新打开也是你自己定：次日零点、某个钟点，或者锁上之后先歇几小时。
- **锁住之前你随时能在设置里关掉它。** 一旦锁上，到你定的那个时间之前规则就冻住了，
  软件里也没法提前打开。
- 你要是绕过去（回终端里直接用 grok，或者去动浏览器存的那条记录），它下次打开是知道的，
  会弹一句**「你没有好好遵守承诺」**，然后把最高那档思考强度扣下来，
  直到你答应下次不再作弊。

锁屏上写的是：

> 今天先到这里。额度明天还会来，今天的光却只有这一次。
> 去走走，吃点热的，把屏幕放下一会儿。

`app/生活模式演示.html` 是一页演示，能把所有锁屏和弹窗都看一遍，不花一点额度。

**内置电脑控制。** Grok 能看见你这块屏幕并且操作它：截图、移鼠标、点击、打字、
按快捷键、列出和切换窗口。这一层就在软件里，只监听 `127.0.0.1`，设置里有开关。
不用另外开后端。

**额度摊开。** 套餐、本期还剩百分之几、按产品分开的用量、下次重置时间、预付余额，
还有每个线程各花了多少 token。全部从官方 CLI 读上来。窗口只显示，不另记一套账。

---

## 其余功能

- 官方登录：浏览器、OAuth、设备码。GUI 不保存密码或令牌。
- 登录后检测认证方式、订阅层级、团队/ZDR 元数据与 Build 会话可用性。
- 从 ACP 实时读取可用模型、上下文上限、以及每个模型支持哪几档思考强度。
  当前会话内就能换模型和强度，不用重启任务。
- 流式回复、思考片段、计划、工具调用、用量、权限审批、错误恢复。
- Grok 历史会话列表、加载、恢复。本地项目与展示元数据存在 SQLite。
- 每个项目首次打开有信任提示。文件浏览、搜索、文本预览都限制在你授权的目录内。
- Git 分支、暂存/未暂存状态，大文件走有界 Diff。
- 内嵌 ConPTY 终端，能跑完整交互式 `grok` TUI 或任意参数组合。
- 模型、会话、MCP、插件、Worktree、Leader、更新、磁盘、配置的只读检查。
- 深色/浅色/跟随系统主题、命令面板、快捷键、隐私与安全诊断导出。
- 原创应用图标、便携 EXE、NSIS 安装包、MSI。

## 运行条件

1. Windows 10 或 11，x64，带 WebView2 运行时（新版 Windows 一般自带）。
2. 能访问 `https://x.ai/cli`。首次启动时本机没有官方 Grok CLI 的话，软件自己去装。
3. 一个有 Grok Build 权限的 Grok / X 账号。

双击 `grok-desk.exe` 就行。不用先装 CLI，也不用先开后端。登录仍然走官方授权页。

**第一次打开要下大约 142 MB**（官方 CLI），装完在 `%USERPROFILE%\.grok` 下占大约
430 MB。界面本身只有 15 MB——大头是被套住的那个东西，不是套子。

## 怎么用

1. 启动 GY Grok。没有官方 CLI 时它自己装。
2. 点「连接账户」完成官方授权。
3. 选一个项目，读一下首次信任说明。
4. 在输入框交给 Grok 任务。要看屏幕时点截图，或者让它自己截。
5. `Ctrl+K` 打开命令面板，`Ctrl+1`…`5` 切换视图，`Ctrl+,` 打开设置。

## 从源码构建

需要 Node.js 20+、Rust stable、Microsoft C++ Build Tools 和 Tauri 的 Windows 依赖。

```powershell
npm ci
npm run tauri dev
```

完整检查：

```powershell
npm run lint
npm test
npm run build
Push-Location src-tauri
cargo fmt -- --check
cargo test
cargo clippy --all-targets -- -D warnings
Pop-Location
```

出便携 EXE、MSI 和 NSIS：

```powershell
npm run tauri build
```

### 要发给别人

```powershell
npm run pack             # 出干净的 zip 到 dist-release/，带 SHA-256
npm run sandbox:release  # 解到空白 USERPROFILE 里跑一遍，看是不是真能用
```

**不要手动压缩 `app/` 文件夹。** 从那里跑过之后，exe 旁边会长出
`grok-desk.exe.WebView2/`——那是 WebView2 的浏览器档案，里面有 Login Data、Cookies
和 History。`npm run pack` 走白名单拷贝，混进任何档案文件就直接中止。

## 架构与安全边界

```text
React / WebView（只渲染数据）
        ↕ Tauri 命令与事件
Rust 主机（校验路径、参数、大小、生命周期）
        ├─ grok agent stdio（ACP）
        ├─ grok TUI（Windows ConPTY）
        ├─ 只读 CLI / Git / 工作区服务
        ├─ 内置电脑控制（只监听 127.0.0.1）
        └─ 本地 SQLite 展示元数据
```

Grok Build 仍然是认证、订阅、会话、模型、工具、权限和更新的唯一事实来源。
GY Grok 不通过 shell 字符串执行后台管理操作；路径会规范化并限制在用户授予的工作区。
ACP 和终端输出有大小与生命周期上限，工具和审批详情在显示前会把常见密钥字段隐去。

详见[架构](docs/ARCHITECTURE.md)、[安全策略](SECURITY.md)和[隐私说明](PRIVACY.md)。

## 已知边界

- 只在 Windows 10/11 x64 上构建和测试过。macOS 是可行的——官方 CLI 有
  `macos-aarch64` 版本，除了电脑控制之外都能平移——但还没做。而且只有 Apple Silicon，
  xAI 没有发 Intel 版的 macOS CLI。
- 安装包没有用商业代码签名证书签名，Windows 可能弹 SmartScreen。请核对 Release 里的
  SHA-256。
- Grok Build 1.0.x 的 ACP 没有向本客户端提供图片/音频提示能力，所以界面会隐藏那些控件。
  完整 CLI 始终可以作为兼容入口。
- 是否弹出权限请求由 Grok Build 决定，只读操作不一定询问。请用版本控制，并检查「更改」页。
- Grok Build / ACP 的上游实验字段可能变化，未知更新会作为脱敏后的结构化卡片显示。

## 许可证

MIT，见 [LICENSE](LICENSE)。

由[机箱上的猫 · GoyoungStudio](https://github.com/ggl003614-tech) 制作。
