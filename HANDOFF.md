# HANDOFF — 现状与 Mac 适配指南

> 写给下一个工作现场（Mac 上做 macOS 版）。Windows 侧代码在 `feat/concurrent-threads` 分支，
> 已全部提交。拉下来先跑 `npm install`，然后看「验证命令」一节。

## 这是什么

GY Grok：Grok Build（官方 CLI）的桌面 GUI。Tauri 2 + React/TS 前端 + Rust 后端，
通过 ACP v1 协议（JSON-RPC over stdio）驱动 `grok agent stdio`。
卖点三件套：内置电脑控制、人类安全模式（生活模式）、额度可视化。

## 当前状态（2026-08-19）

`feat/concurrent-threads` 分支比初始提交多 5 个 commit，全部测试通过
（前端 vitest 187 / Rust cargo 55），但**下面标「待手验」的项目还没有人肉开过界面确认**。

| 功能 | 状态 |
|---|---|
| 多线程并发：切走的线程后台继续跑，侧栏转圈/未读点，可直接停 | 待手验 |
| 后台任务面板：CLI 的后台命令 + 子智能体显形，可停 | 待手验 |
| 删除线程：hover 垃圾桶 → 行内确认，远端/本地/快照三层清 | 待手验 |
| 切线程写坏存档（数据损坏 bug）已修，本机 22 条坏指针已修复 | 已验证（数据库层面） |
| 子智能体不再霸占侧栏（session_kind 过滤） | 已验证（磁盘数据） |
| 系统代理自动注入（Clash 系统代理模式下 CLI 直连被墙的问题） | 已验证（curl 层面） |
| /compact 上下文压缩按钮、上下文占比显示 | 已手验 |
| 预览面板 Claude 风格、流式合并、贴底滚动、控制电脑开关 | 已手验 |

**没做的**：任务完成 Windows 通知；「gulp 时 Grok 老停」未查（缺复现信息）；
跨项目目录的并发（换 cwd 会重启 agent 进程，杀掉在跑的线程）。

## 关键文件地图

```
src/acpClient.ts        ACP 客户端。prompt/cancel 收 sessionId 参数；focusSession 换焦点不发请求
src/threadRuntime.ts    并发状态层：快照进出、update 路由、输入框解锁判定。纯函数，测试全
src/backgroundTasks.ts  从 update 流认出后台命令/子智能体。夹具是真实抓包 fixtures/background-tasks.json
src/transcriptPersist.ts 存档绑定：排定时拷内容、落盘前验身份。对应数据损坏 bug
src/sessionUpdates.ts   update -> 时间线。流式合并跨过交替的 thought/assistant 块
src/sidebarTree.ts      侧栏树 + isJunkSession/isSubagentSession 过滤
src-tauri/src/agent.rs  spawn grok agent stdio。单进程槽 Mutex<Option<AgentProcess>>
src-tauri/src/platform.rs grok 可执行文件定位 + adopt_system_proxy（读 WinINET 注册表）
src-tauri/src/history.rs  读 ~/.grok/sessions 磁盘会话（session_kind 在这里读）
src-tauri/src/bootstrap.rs 首启自动装官方 CLI（x.ai/cli/stable 频道）
src-tauri/src/instance.rs  单实例互斥量 + 找回窗口（纯 win32）
src-tauri/src/computer.rs  内置电脑控制（截屏/键鼠，纯 win32）
```

## 实测得出的协议事实（别重新踩坑）

1. **一个 `grok agent stdio` 进程支持多会话真并发**。两路 session/prompt 的
   update 在时间线上穿插（实测重叠 13.5s）。并发不需要多进程。
2. **同一会话上再发 prompt = 打断**：正在跑的那轮直接返回 `cancelled`。
   「停止后台任务」就是靠这个 + 发一条让 Grok 调 kill_command_or_subagent 的 prompt。
3. **子智能体是独立会话**，存在正常 sessions 树里，唯一标记是 summary.json 的
   `"session_kind": "subagent"`。不过滤它们就会挤爆侧栏。
4. 后台命令识别靠 `rawOutput.type === "BackgroundTaskStarted"`；子智能体 id 只在
   spawn_subagent 回执**正文**里（`subagent_id: <uuid>`），没有结构化字段。
5. Grok CLI 只认 HTTP(S)_PROXY 环境变量，不读系统代理。

## Mac 适配清单（按工作量排序）

**Tauri 层免费得到的**：WebView2→WKWebView、窗口管理、打包（DMG）由 Tauri 处理，不用动。

1. `platform.rs` — `grok_executable()` 找的是 `.grok/bin/grok.exe`，Mac 上是无后缀
   `grok`（代码里已有候选，验证即可）。`adopt_system_proxy()` 读 WinINET 注册表，
   Mac 版走 `scutil --proxy` 或干脆只认环境变量（Mac 上 GUI 进程的 env 注入方式
   不同，launchctl setenv，优先级低——建议 Mac 上先跳过，Clash 用户开 TUN）。
   `configure_tokio_command` 里 CREATE_NO_WINDOW 是 win32 flag，已有 cfg 门。
2. `bootstrap.rs` — `cli_platform()` 只认 windows-x86_64/aarch64，要加
   `darwin-aarch64`/`darwin-x86_64`（先确认 x.ai/cli 频道有没有 Mac 产物；
   没有就引导用户 `curl | sh` 装官方 CLI，跳过自动安装）。下载后的 chmod +x 别忘。
3. `instance.rs` — 单实例是 CreateMutexW + FindWindowW，纯 win32。Mac 上用
   Tauri 的 single-instance 插件替换，或干脆 Mac 允许多开（反正并发已经支持）。
4. `computer.rs` — 截屏和键鼠是 SendInput/BitBlt，纯 win32，**这是最大的一块**。
   Mac 等价物是 CGEvent/CGDisplay + 辅助功能权限（TCC 弹窗）。建议第一版直接
   `#[cfg(not(windows))]` 禁用电脑控制，界面上灰掉，先把主流程跑通。
5. `history.rs`/`extensions.rs`/`cli.rs` 里的零星 cfg(windows) —— 都有 not(windows)
   分支，编译能过，逐个验证行为即可。

建议顺序：先 `cargo check` 看编译，把 computer.rs 禁掉，主流程（连接/对话/线程）
跑通后再谈电脑控制。

## 验证命令

```
npm install
npx tsc -b               # 类型
npx vitest run           # 前端 187 个测试
cd src-tauri && cargo test   # Rust 55 个测试
npm run tauri dev        # 开发跑起来
```

## 数据位置（Windows，Mac 对应改）

- 本地线程库：`%APPDATA%/dev.grokdesk.desktop/grok-desk.sqlite3`（Mac: `~/Library/Application Support/dev.grokdesk.desktop/`）
- CLI 会话：`~/.grok/sessions/<url-encoded-cwd>/<session-id>/`
- CLI 本体：`~/.grok/bin/`

## 已知风险

- `app/` 目录（Windows 便携版）在 .gitignore 里，**里面的 WebView2 浏览器配置含
  登录凭据，永远不要进 git**。打包发人用 `npm run pack`（有防泄漏扫描）。
- 数据库修复备份在 `%APPDATA%/dev.grokdesk.desktop/backup-20260819-131152/`。
