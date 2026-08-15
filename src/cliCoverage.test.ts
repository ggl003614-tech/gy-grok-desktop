import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  GROK_CLI_COVERAGE,
  missingCliCoverage,
  parseGrokHelpCommands,
} from "./cliCoverage";

const fixture = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "grok-help.txt");

function grokHelpText() {
  const grok = join(process.env.USERPROFILE || "", ".grok", "bin", "grok.exe");
  if (existsSync(grok)) {
    try {
      return execFileSync(grok, ["--help"], { encoding: "utf8", timeout: 15_000 });
    } catch {
      // fall through to the committed fixture
    }
  }
  return readFileSync(fixture, "utf8");
}

describe("CLI coverage table", () => {
  it("maps every grok --help command to a shipped Desk surface", () => {
    const help = grokHelpText();
    const commands = parseGrokHelpCommands(help);
    expect(commands.length).toBeGreaterThan(10);
    expect(missingCliCoverage(help)).toEqual([]);
    for (const command of commands) {
      const row = GROK_CLI_COVERAGE.find((entry) => entry.id === command);
      expect(row, `missing coverage for ${command}`).toBeTruthy();
      expect(row?.surface).toMatch(
        /^(chat|sessions|extensions|account|settings|manage|terminal)$/,
      );
    }
    const terminal = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "TerminalPanel.tsx"), "utf8");
    expect(terminal).toContain("GROK_CLI_COVERAGE");
  });
});
