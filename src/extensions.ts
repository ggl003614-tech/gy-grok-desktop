export interface McpServerInfo {
  name: string;
  transport: string;
  target: string;
  sourceType: string;
  sourceLabel: string;
  enabled: boolean;
  managed: boolean;
}

export interface SkillInfo {
  name: string;
  description: string;
  path: string;
  sourceType: string;
  userInvocable: boolean;
}

export interface ExtensionSnapshot {
  mcpServers: McpServerInfo[];
  skills: SkillInfo[];
}

export function contextUsagePercent(used?: number, size?: number) {
  if (!used || !size || size <= 0) return undefined;
  return Math.max(0, Math.min(100, Math.round((used / size) * 100)));
}

export function sourceLabel(type: string) {
  switch (type) {
    case "user":
    case "config":
      return "Grok";
    case "claudeJson":
    case "claude":
      return "Claude";
    case "mcpJson":
    case "cursor":
      return "Cursor";
    case "plugin":
      return "插件";
    case "project":
      return "项目";
    default:
      return type || "本机";
  }
}
