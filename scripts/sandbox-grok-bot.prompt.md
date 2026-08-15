把下面整段发给 Grok Bot（那个带 Linux 虚拟机的）。

它测的是：干净 Linux 能不能拿到官方 Grok CLI，以及 CLI 是否依赖本机偷偷开着的服务。

它测不了 GY Grok 窗口。那是 Windows + WebView2，Grok Bot 的 Linux 跑不起来。

---

你有一台干净的 Linux 虚拟机。请做一次新用户冒烟测试，不要装 Wine，不要尝试运行任何 `.exe`。

请把下面脚本原样写到 `/tmp/gy-grok-bot-sandbox.sh`，`chmod +x` 后执行，然后把终端里的完整输出和最后的 JSON 报告原样发回来。

脚本内容就是仓库里的 `scripts/sandbox-grok-bot.sh`。若你读不到仓库，用这段最小等价步骤：

1. `uname -s` / `uname -m`，确认是 Linux。
2. 用空白 `HOME`（例如 `/tmp/gy-blank-home`），不要用当前用户已有的 `~/.grok`。
3. 打开 `https://x.ai/cli/stable` 读出版本号。
4. 按架构下载：
   - x86_64 → `https://x.ai/cli/grok-<版本>-linux-x86_64`
   - aarch64 → `https://x.ai/cli/grok-<版本>-linux-aarch64`
5. `chmod +x` 后在空白 HOME 下跑 `./grok version`。
6. 检查 `127.0.0.1:18765` 是否在监听。不应该在。这个口只有 Windows 上的 GY Grok 才会自己开。
7. 向 `./grok agent stdio` 写一行 `{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":1,"clientCapabilities":{}}}`，看有没有 `cached_token`。干净机器不应该有。
8. 把每一步的成功/失败写清楚。

不要登录、不要改系统包、不要访问我的 Windows 路径。
