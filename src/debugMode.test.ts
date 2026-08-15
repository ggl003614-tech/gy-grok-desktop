import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { formatDebugEntry } from "./debugMode";

const srcDir = dirname(fileURLToPath(import.meta.url));

describe("debug / Go mode", () => {
  it("formats a representative agent notification into a non-empty debug line", () => {
    const line = formatDebugEntry({
      source: "notification",
      method: "session/update",
      payload: {
        sessionUpdate: "tool_call",
        toolCallId: "tool-1",
        title: "read_file",
        status: "in_progress",
      },
    });
    expect(line.trim().length).toBeGreaterThan(0);
    expect(line).toContain("tool_call");
    expect(line).toContain("read_file");
  });

  it("formats a raw agent log line", () => {
    const line = formatDebugEntry({ source: "log", payload: "acp: session/prompt started" });
    expect(line).toContain("acp: session/prompt started");
  });

  it("wires a Debug or Go control in the GUI source", () => {
    const app = readFileSync(join(srcDir, "App.tsx"), "utf8");
    const settings = readFileSync(join(srcDir, "SettingsPanel.tsx"), "utf8");
    const surface = `${app}\n${settings}`;
    expect(/Go 模式|debug mode|调试模式|settings\.go/i.test(surface)).toBe(true);
    expect(/formatDebugEntry|goMode|debugMode/.test(surface)).toBe(true);
  });
});
