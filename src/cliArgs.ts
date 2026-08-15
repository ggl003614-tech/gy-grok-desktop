export function parseCliArgs(input: string): string[] {
  const args: string[] = [];
  let current = "";
  let quote: '"' | "'" | undefined;
  let escaping = false;
  let started = false;

  const source = input.trim();
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (escaping) {
      current += character;
      escaping = false;
      started = true;
      continue;
    }
    if (
      character === "\\" &&
      quote === '"' &&
      (source[index + 1] === '"' || source[index + 1] === "\\")
    ) {
      escaping = true;
      started = true;
      continue;
    }
    if (quote) {
      if (character === quote) quote = undefined;
      else current += character;
      started = true;
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      started = true;
      continue;
    }
    if (/\s/.test(character)) {
      if (started) {
        args.push(current);
        current = "";
        started = false;
      }
      continue;
    }
    current += character;
    started = true;
  }

  if (escaping || quote) throw new Error("CLI 参数包含未闭合的引号或转义符");
  if (started) args.push(current);
  if (args[0]?.toLowerCase() === "grok") args.shift();
  return args;
}

export type SessionLaunchMode = "new" | "continue" | "resume";
export type ToggleMode = "default" | "enabled" | "disabled";

export interface AdvancedCliConfig {
  prompt?: string;
  model?: string;
  reasoningEffort?: string;
  permissionMode?: string;
  sandbox?: string;
  sessionMode?: SessionLaunchMode;
  resumeSession?: string;
  worktree?: string;
  worktreeRef?: string;
  agent?: string;
  subagentsJson?: string;
  rules?: string;
  tools?: string;
  disallowedTools?: string;
  maxTurns?: string;
  memory?: ToggleMode;
  plan?: ToggleMode;
  subagents?: ToggleMode;
  alwaysApprove?: boolean;
  disableWebSearch?: boolean;
  forkSession?: boolean;
  restoreCode?: boolean;
  verbatim?: boolean;
}

function pair(args: string[], flag: string, value?: string) {
  const normalized = value?.trim();
  if (normalized) args.push(flag, normalized);
}

export function buildAdvancedCliArgs(config: AdvancedCliConfig): string[] {
  const args: string[] = [];
  pair(args, "--model", config.model);
  pair(args, "--reasoning-effort", config.reasoningEffort);
  pair(args, "--permission-mode", config.permissionMode);
  pair(args, "--sandbox", config.sandbox);
  pair(args, "--agent", config.agent);
  pair(args, "--agents", config.subagentsJson);
  pair(args, "--rules", config.rules);
  pair(args, "--tools", config.tools);
  pair(args, "--disallowed-tools", config.disallowedTools);
  pair(args, "--max-turns", config.maxTurns);

  if (config.sessionMode === "continue") args.push("--continue");
  if (config.sessionMode === "resume") {
    args.push("--resume");
    if (config.resumeSession?.trim()) args.push(config.resumeSession.trim());
  }
  if (config.worktree !== undefined) {
    args.push(config.worktree.trim() ? `--worktree=${config.worktree.trim()}` : "--worktree");
    pair(args, "--worktree-ref", config.worktreeRef);
  }
  if (config.memory === "enabled") args.push("--experimental-memory");
  if (config.memory === "disabled") args.push("--no-memory");
  if (config.plan === "disabled") args.push("--no-plan");
  if (config.subagents === "disabled") args.push("--no-subagents");
  if (config.alwaysApprove) args.push("--always-approve");
  if (config.disableWebSearch) args.push("--disable-web-search");
  if (config.forkSession) args.push("--fork-session");
  if (config.restoreCode) args.push("--restore-code");
  if (config.verbatim) args.push("--verbatim");
  if (config.prompt?.trim()) args.push(config.prompt.trim());
  return args;
}

export function formatCliArgs(args: string[]): string {
  return args
    .map((arg) =>
      arg && !/[\s"']/.test(arg)
        ? arg
        : `"${arg.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`,
    )
    .join(" ");
}

export function describeCliRisk(args: string[]): string | undefined {
  const normalized = args.map((arg) => arg.toLowerCase());
  if (
    normalized.includes("--always-approve") ||
    normalized.some(
      (arg, index) =>
        arg === "--permission-mode" &&
        normalized[index + 1] === "bypasspermissions",
    )
  ) {
    return "该配置会绕过逐项工具审批，Grok 可直接执行命令和修改文件";
  }
  const knownCommands = [
    "logout",
    "sessions",
    "worktree",
    "update",
    "setup",
    "mcp",
    "plugin",
    "memory",
    "trace",
  ];
  const command = normalized.find((arg) => knownCommands.includes(arg));
  const commandIndex = command ? normalized.indexOf(command) : -1;
  const subcommand = commandIndex >= 0 ? normalized[commandIndex + 1] : undefined;
  if (command === "logout") return "该操作会清除这台电脑上的 Grok 登录凭据";
  if (command === "sessions" && subcommand === "delete") {
    return "该操作会永久删除 Grok 会话历史";
  }
  if (command === "worktree" && ["rm", "gc", "db"].includes(subcommand ?? "")) {
    return "该操作可能删除或修改 Grok 管理的 Git worktree";
  }
  if (command === "update" && !normalized.includes("--check")) {
    return "该操作会修改已安装的 Grok CLI 版本";
  }
  if (["setup"].includes(command ?? "")) {
    return "该操作会下载并修改 Grok 的托管配置";
  }
  if (["mcp", "plugin", "memory"].includes(command ?? "") && subcommand !== "list") {
    return "该操作可能修改 Grok 的工具、插件或记忆配置";
  }
  if (command === "trace" && normalized.includes("upload")) {
    return "该操作会向 Grok 服务上传会话追踪数据";
  }
  return undefined;
}

export function requiresCliConfirmation(args: string[]): boolean {
  return describeCliRisk(args) !== undefined;
}
