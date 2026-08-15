export type DeskSurface =
  | "chat"
  | "sessions"
  | "extensions"
  | "account"
  | "settings"
  | "manage"
  | "terminal";

export interface CliCoverageRow {
  id: string;
  surface: DeskSurface;
}

export const GROK_CLI_COVERAGE: CliCoverageRow[] = [
  { id: "agent", surface: "terminal" },
  { id: "completions", surface: "terminal" },
  { id: "dashboard", surface: "terminal" },
  { id: "doctor", surface: "terminal" },
  { id: "du", surface: "manage" },
  { id: "export", surface: "sessions" },
  { id: "help", surface: "terminal" },
  { id: "inspect", surface: "manage" },
  { id: "leader", surface: "manage" },
  { id: "login", surface: "account" },
  { id: "logout", surface: "account" },
  { id: "mcp", surface: "extensions" },
  { id: "memory", surface: "terminal" },
  { id: "models", surface: "settings" },
  { id: "plugin", surface: "extensions" },
  { id: "sessions", surface: "sessions" },
  { id: "setup", surface: "terminal" },
  { id: "trace", surface: "terminal" },
  { id: "update", surface: "manage" },
  { id: "version", surface: "manage" },
  { id: "worktree", surface: "manage" },
  { id: "wrap", surface: "terminal" },
];

export function parseGrokHelpCommands(helpText: string): string[] {
  const text = helpText.replace(/^\uFEFF/, "").replace(/\r/g, "");
  const start = text.search(/^Commands:\s*$/m);
  if (start < 0) return [];
  const section = text.slice(start);
  const ids: string[] = [];
  for (const line of section.split("\n").slice(1)) {
    if (/^[A-Z]/.test(line) && !/^\s/.test(line)) break;
    const match = line.match(/^\s{2}([a-z][\w-]*)\s{2,}/);
    if (match) ids.push(match[1]);
  }
  return ids;
}

export function missingCliCoverage(helpText: string): string[] {
  const commands = parseGrokHelpCommands(helpText);
  const known = new Set(GROK_CLI_COVERAGE.map((row) => row.id));
  return commands.filter((id) => !known.has(id));
}
