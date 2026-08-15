import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { conversationEmptyKind, shouldShowConversationList } from "./conversationView";

const srcDir = dirname(fileURLToPath(import.meta.url));

describe("conversation render path", () => {
  it("shows the list branch when user/assistant/tool rows exist", () => {
    expect(shouldShowConversationList([])).toBe(false);
    expect(shouldShowConversationList([
      { id: "u", kind: "user", text: "你好" },
      { id: "a", kind: "assistant", text: "在的" },
    ])).toBe(true);
  });

  it("does not collapse the conversation list to auto height", () => {
    const css = readFileSync(join(srcDir, "App.css"), "utf8");
    const app = readFileSync(join(srcDir, "App.tsx"), "utf8");
    expect(app).toMatch(/shouldShowConversationList|timelineRows/);
    expect(css).toMatch(/\.conversation\b/);
    expect(css).not.toMatch(/message-virtual-list[\s\S]{0,180}height:\s*auto\s*!important/);
    expect(
      /\.message-scroll-list[\s\S]{0,220}overflow:\s*auto/.test(css)
      || /\.message-virtual-list[\s\S]{0,220}height:\s*100%/.test(css),
    ).toBe(true);
  });

  it("does not keep the folder picker on screen while a project is connecting", () => {
    expect(conversationEmptyKind({
      connecting: true,
      connected: false,
      project: "E:\\projects\\grok-desktop",
    })).toBe("connecting");
    expect(conversationEmptyKind({
      restoring: true,
      connecting: true,
      project: "E:\\work",
    })).toBe("restoring");
    expect(conversationEmptyKind({
      pendingTrust: "E:\\work",
      connecting: false,
    })).toBe("trust");
    expect(conversationEmptyKind({
      connected: true,
      project: "E:\\work",
    })).toBe("ready");
    expect(conversationEmptyKind({
      connected: false,
      project: "",
    })).toBe("pick-folder");
  });

  it("gives the chat pane a named grid row so messages cannot collapse to zero height", () => {
    const css = readFileSync(join(srcDir, "App.css"), "utf8");
    expect(css).toMatch(/grid-template-areas:[\s\S]{0,80}conversation/);
    expect(css).toMatch(/\.conversation[^{]*\{[^}]*grid-area:\s*conversation/);
    expect(css).not.toMatch(/\.conversation\s*\{[^}]*height:\s*auto/);
  });
});
