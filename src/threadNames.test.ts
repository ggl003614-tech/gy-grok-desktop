import { describe, expect, it } from "vitest";
import { applyThreadNames, loadThreadNames, saveThreadName } from "./threadNames";
import { looksLikeCodeTitle, sessionTitle } from "./sidebarTree";

const memory = new Map<string, string>();
const storage = {
  getItem: (key: string) => memory.get(key) ?? null,
  setItem: (key: string, value: string) => {
    memory.set(key, value);
  },
  clear: () => memory.clear(),
  removeItem: (key: string) => {
    memory.delete(key);
  },
};
Object.defineProperty(globalThis, "localStorage", { value: storage, configurable: true });

describe("thread names", () => {
  it("stores a custom name and applies it to the session list", () => {
    memory.clear();
    saveThreadName("abc", "工作室管线");
    expect(loadThreadNames().abc).toBe("工作室管线");
    expect(
      applyThreadNames([{ sessionId: "abc", title: "线程 019ffa2" }])[0].title,
    ).toBe("工作室管线");
  });

  it("does not show raw session codes as titles", () => {
    expect(looksLikeCodeTitle("线程 019ffa2c")).toBe(true);
    expect(sessionTitle({ sessionId: "019ffa2c-1234" })).toBe("未命名对话");
    expect(sessionTitle({ sessionId: "x", title: "阅读项目" })).toBe("阅读项目");
  });
});
