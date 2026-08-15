import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { OFFICIAL_BILLING_URL, OFFICIAL_USAGE_URL } from "./AccountHub";

const root = dirname(fileURLToPath(import.meta.url));

describe("official billing", () => {
  it("opens the official grok.com usage page for the new reset token", () => {
    expect(OFFICIAL_USAGE_URL).toBe("https://grok.com/?_s=usage");
    expect(OFFICIAL_BILLING_URL).toBe("https://grok.com/?_s=billing");
  });

  it("gives the connectors page a close control back to the thread", () => {
    const source = readFileSync(join(root, "AccountHub.tsx"), "utf8");
    expect(source).toMatch(/onClose/);
    expect(source).toMatch(/common\.close/);
    expect(source).toMatch(/connector-grid/);
  });
});
