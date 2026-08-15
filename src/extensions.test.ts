import { describe, expect, it } from "vitest";
import { contextUsagePercent, sourceLabel } from "./extensions";

describe("extensions helpers", () => {
  it("clamps context usage to a readable percent", () => {
    expect(contextUsagePercent(38, 100)).toBe(38);
    expect(contextUsagePercent(200, 100)).toBe(100);
    expect(contextUsagePercent(0, 100)).toBeUndefined();
  });

  it("maps skill and MCP sources to short labels", () => {
    expect(sourceLabel("user")).toBe("Grok");
    expect(sourceLabel("claudeJson")).toBe("Claude");
    expect(sourceLabel("mcpJson")).toBe("Cursor");
  });
});
