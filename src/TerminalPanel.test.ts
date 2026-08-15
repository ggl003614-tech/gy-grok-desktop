import { describe, expect, it } from "vitest";
import {
  buildAdvancedCliArgs,
  formatCliArgs,
  parseCliArgs,
  requiresCliConfirmation,
} from "./cliArgs";

describe("parseCliArgs", () => {
  it("passes explicit arguments without invoking a shell", () => {
    expect(parseCliArgs('grok sessions search "fix login" --limit 20')).toEqual([
      "sessions",
      "search",
      "fix login",
      "--limit",
      "20",
    ]);
  });

  it("supports empty arguments and quoted empty values", () => {
    expect(parseCliArgs("   ")).toEqual([]);
    expect(parseCliArgs("--prompt ''")).toEqual(["--prompt", ""]);
  });

  it("rejects incomplete quoting", () => {
    expect(() => parseCliArgs('sessions search "broken')).toThrow(/引号/);
  });

  it("round-trips Windows paths and JSON through the visible command field", () => {
    const args = [
      "--agent",
      "C:\\Users\\tester\\agent profile.md",
      "--agents",
      '{"reviewer":{"description":"code review"}}',
    ];
    expect(parseCliArgs(formatCliArgs(args))).toEqual(args);
  });

  it("builds the complete interactive launch configuration as explicit arguments", () => {
    expect(
      buildAdvancedCliArgs({
        prompt: "inspect this project",
        model: "grok-4.6",
        reasoningEffort: "xhigh",
        permissionMode: "acceptEdits",
        sandbox: "workspace-write",
        sessionMode: "resume",
        resumeSession: "saved task",
        worktree: "review",
        worktreeRef: "main",
        agent: "reviewer",
        subagentsJson: '{"tester":{}}',
        rules: "Do not publish",
        tools: "read_file,run_command",
        disallowedTools: "web_search",
        maxTurns: "30",
        memory: "enabled",
        plan: "disabled",
        subagents: "disabled",
        disableWebSearch: true,
        forkSession: true,
        restoreCode: true,
        verbatim: true,
      }),
    ).toEqual([
      "--model", "grok-4.6",
      "--reasoning-effort", "xhigh",
      "--permission-mode", "acceptEdits",
      "--sandbox", "workspace-write",
      "--agent", "reviewer",
      "--agents", '{"tester":{}}',
      "--rules", "Do not publish",
      "--tools", "read_file,run_command",
      "--disallowed-tools", "web_search",
      "--max-turns", "30",
      "--resume", "saved task",
      "--worktree=review",
      "--worktree-ref", "main",
      "--experimental-memory",
      "--no-plan",
      "--no-subagents",
      "--disable-web-search",
      "--fork-session",
      "--restore-code",
      "--verbatim",
      "inspect this project",
    ]);
  });

  it("requires an explicit confirmation for bypass modes", () => {
    expect(requiresCliConfirmation(["--always-approve"])).toBe(true);
    expect(
      requiresCliConfirmation(["--permission-mode", "bypassPermissions"]),
    ).toBe(true);
    expect(requiresCliConfirmation(["--permission-mode", "default"])).toBe(false);
  });
});
