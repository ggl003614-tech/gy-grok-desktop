import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = dirname(fileURLToPath(import.meta.url));

describe("shipped software bootstrap", () => {
  it("installs official CLI from x.ai and wires computer control without a separate backend", () => {
    const bootstrap = readFileSync(join(root, "../src-tauri/src/bootstrap.rs"), "utf8");
    const app = readFileSync(join(root, "App.tsx"), "utf8");
    expect(bootstrap).toMatch(/https:\/\/x\.ai\/cli\/stable/);
    expect(bootstrap).toMatch(/ensure_runtime/);
    expect(bootstrap).toMatch(/prepare_for_product/);
    expect(app).toMatch(/welcome\.preparing/);
    expect(app).toMatch(/installing/);
  });

  it("ships a complete app folder others can copy", () => {
    const pack = readFileSync(join(root, "../scripts/copy-desk.mjs"), "utf8");
    expect(pack).toMatch(/启动 Grok Desk\.cmd/);
    expect(pack).toMatch(/安装到这台电脑\.cmd/);
    expect(pack).toMatch(/使用说明\.txt/);
    expect(pack).toMatch(/EBUSY/);
  });
});
