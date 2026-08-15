import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = dirname(fileURLToPath(import.meta.url));

describe("computer control surface", () => {
  it("ships an opt-in 控制电脑 setting and composer badge", () => {
    const settings = readFileSync(join(root, "SettingsPanel.tsx"), "utf8");
    const app = readFileSync(join(root, "App.tsx"), "utf8");
    expect(settings).toMatch(/settings\.computerAllow/);
    expect(settings).toMatch(/settings\.capture\.low/);
    expect(settings).toMatch(/set_computer_control/);
    expect(app).toMatch(/computer-chip/);
    expect(app).toMatch(/take_screenshot/);
    expect(app).toMatch(/ensure_runtime/);
    expect(app).toMatch(/composer\.computer/);
  });

  it("keeps the rust host gated and registered as official MCP", () => {
    const computer = readFileSync(join(root, "../src-tauri/src/computer.rs"), "utf8");
    const control = readFileSync(join(root, "../src-tauri/src/computer_control.rs"), "utf8");
    const main = readFileSync(join(root, "../src-tauri/src/main.rs"), "utf8");
    expect(computer).toMatch(/desk-computer/);
    expect(computer).toMatch(/gate_enabled/);
    const mcp = readFileSync(join(root, "../src-tauri/src/computer_mcp.rs"), "utf8");
    expect(mcp).toMatch(/newline-delimited JSON/);
    expect(mcp).not.toMatch(/write!\(writer, "Content-Length/);
    expect(control).toMatch(/HTTP_URL/);
    expect(control).toMatch(/transport: Some\("http"/);
    expect(main).toMatch(/COMPUTER_MCP_FLAG|--computer-mcp/);
    const http = readFileSync(join(root, "../src-tauri/src/computer_http.rs"), "utf8");
    expect(http).toMatch(/streamable-HTTP MCP/);
  });
});
