import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  classifyLocalService,
  firstRunNeeds,
  grokLookupOrder,
  linuxSandboxCanTest,
  linuxSandboxCannotTest,
  officialCliArtifact,
  shippedLocalOnlyHits,
} from "./sandboxAudit";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

describe("new-user sandbox audit", () => {
  it("treats the computer MCP port as in-process, not a hidden backend", () => {
    const finding = classifyLocalService("127.0.0.1:18765", true);
    expect(finding.severity).toBe("ok");
    expect(finding.id).toBe("computer-mcp");
  });

  it("does not ship production Rust that hard-codes this PC's profile", () => {
    const rustFiles = [
      "src-tauri/src/bootstrap.rs",
      "src-tauri/src/platform.rs",
      "src-tauri/src/lib.rs",
      "src-tauri/src/cli.rs",
      "src-tauri/src/computer.rs",
      "src-tauri/src/computer_http.rs",
      "src-tauri/src/computer_control.rs",
    ];
    for (const relative of rustFiles) {
      const source = readFileSync(join(root, relative), "utf8");
      expect(shippedLocalOnlyHits(source), relative).toEqual([]);
    }
  });

  it("resolves Grok from the user profile or PATH, then can install the official CLI", () => {
    expect(grokLookupOrder()[1]).toMatch(/USERPROFILE/);
    expect(firstRunNeeds().some((item) => item.includes("x.ai/cli"))).toBe(true);
    const bootstrap = readFileSync(join(root, "src-tauri/src/bootstrap.rs"), "utf8");
    expect(bootstrap).toMatch(/https:\/\/x\.ai\/cli/);
    expect(bootstrap).toMatch(/fn install_official_cli/);
    const lib = readFileSync(join(root, "src-tauri/src/lib.rs"), "utf8");
    expect(lib).toMatch(/computer_http::start\(\)/);
  });

  it("tells Grok Bot's Linux VM to test the official CLI, not the Windows GUI", () => {
    expect(officialCliArtifact("1.0.4", "linux-x86_64")).toBe("https://x.ai/cli/grok-1.0.4-linux-x86_64");
    expect(officialCliArtifact("1.0.4", "windows-x86_64")).toBe("https://x.ai/cli/grok-1.0.4-windows-x86_64.exe");
    expect(linuxSandboxCanTest().join(" ")).toMatch(/CLI/);
    expect(linuxSandboxCannotTest().join(" ")).toMatch(/WebView2/);
    const bot = readFileSync(join(root, "scripts/sandbox-grok-bot.sh"), "utf8");
    expect(bot).toMatch(/linux-x86_64/);
    expect(bot).not.toMatch(/wine grok-desk/i);
  });
});
