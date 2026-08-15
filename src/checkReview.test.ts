import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { CHECK_ACTIONS, checkPromptFor } from "./reviewActions";

const root = dirname(fileURLToPath(import.meta.url));

describe("official check / review actions", () => {
  it("surfaces the official /review and /code-review skills first", () => {
    expect(CHECK_ACTIONS.map((item) => item.id)).toEqual(["local", "project", "quality"]);
    expect(checkPromptFor("local")).toBe("/review --local");
    expect(checkPromptFor("quality")).toBe("/code-review");
    expect(checkPromptFor("project")).toContain("不要直接修改");
  });

  it("falls back to a read-only review prompt when the slash is not advertised", () => {
    expect(checkPromptFor("local", [{ name: "usage" }])).not.toMatch(/^\/review/);
    expect(checkPromptFor("local", [{ name: "review" }])).toBe("/review --local");
    expect(checkPromptFor("quality", [{ name: "user:code-review" }])).toBe("/code-review");
  });

  it("wires a labeled 检查 control into chat and the changes page", () => {
    const plus = readFileSync(join(root, "ComposerPlus.tsx"), "utf8");
    const changes = readFileSync(join(root, "ChangesPanel.tsx"), "utf8");
    expect(plus).toMatch(/plus\.screenshot/);
    expect(plus).toMatch(/CHECK_ACTIONS/);
    expect(plus).toMatch(/onCheck/);
    expect(changes).toMatch(/让 Grok 审查/);
  });
});
