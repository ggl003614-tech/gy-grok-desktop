import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  applyParsedUpdate,
  groupTimeline,
  parseSessionUpdate,
} from "./sessionUpdates";
import {
  hasVisibleConversationTurns,
  parseGrokChatHistory,
  parseGrokExport,
  parseGrokTranscriptPayload,
  timelineFromAcpUpdates,
} from "./grokHistory";

const fixtureDir = join(dirname(fileURLToPath(import.meta.url)), "fixtures");

describe("grok history and live timeline", () => {
  it("keeps tool_result image payloads from Grok chat_history", () => {
    const items = parseGrokChatHistory(
      `${JSON.stringify({
        type: "tool_result",
        tool_call_id: "img-1",
        name: "read_file",
        content: "Read image file: D:\\\\studio\\\\images\\\\1.jpg",
        images: [{ type: "image", url: "data:image/png;base64,abc" }],
      })}\n`,
    );
    expect(items[0]).toMatchObject({
      kind: "tool",
      images: [{ src: "data:image/png;base64,abc" }],
    });
  });

  it("restores user and assistant text from Grok chat_history.jsonl", () => {
    const jsonl = readFileSync(join(fixtureDir, "grok-chat-history.jsonl"), "utf8");
    const items = parseGrokChatHistory(jsonl);
    expect(items.some((item) => item.kind === "user" && item.text.includes("阅读我的项目"))).toBe(true);
    expect(items.some((item) => item.kind === "assistant" && item.text.includes("Go Young Studio"))).toBe(true);
    expect(hasVisibleConversationTurns(items)).toBe(true);
  });

  it("keeps plain user lines and skips system-only blobs", () => {
    const items = parseGrokChatHistory(`
{"role":"user","content":"直接发一句"}
{"type":"user","content":[{"type":"text","text":"<user_info>os</user_info>\\n<system-reminder>ignore</system-reminder>"}]}
{"type":"assistant","content":"收到。"}
`);
    expect(items.find((item) => item.kind === "user")?.text).toBe("直接发一句");
    expect(items.some((item) => item.text.includes("system-reminder"))).toBe(false);
    expect(items.some((item) => item.kind === "assistant" && item.text.includes("收到"))).toBe(true);
  });

  it("keeps markdown headings inside an assistant export section", () => {
    const items = parseGrokExport(`
## User

看一下项目

## Assistant

handoff 找到了。

## 项目是什么

Grok Desk 是桌面客户端。

## User

还有问题
`);
    const assistant = items.find((item) => item.kind === "assistant");
    expect(assistant?.text).toContain("项目是什么");
    expect(assistant?.text).toContain("Grok Desk 是桌面客户端");
    expect(items.filter((item) => item.kind === "user").map((item) => item.text)).toEqual([
      "看一下项目",
      "还有问题",
    ]);
  });

  it("keeps short assistant replies and tool rows from export markdown", () => {
    const markdown = readFileSync(join(fixtureDir, "grok-export.md"), "utf8");
    const items = parseGrokExport(markdown);
    expect(items.some((item) => item.kind === "user" && item.text.includes("人呢"))).toBe(true);
    expect(items.some((item) => item.kind === "assistant" && item.text.includes("在的"))).toBe(true);
    expect(items.some((item) => item.kind === "tool")).toBe(true);
    expect(hasVisibleConversationTurns(items)).toBe(true);
  });

  it("replays live ACP updates into visible user, assistant, and tool rows", () => {
    const updates = [
      {
        sessionUpdate: "user_message_chunk",
        content: { type: "text", text: "帮我看一下登录闪退" },
      },
      {
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text: "我先读相关文件。" },
      },
      {
        sessionUpdate: "tool_call",
        toolCallId: "tool-read-1",
        title: "read_file",
        status: "completed",
        rawInput: { path: "E:\\\\web\\\\index.html" },
      },
    ];
    const items = timelineFromAcpUpdates(updates);
    const rows = groupTimeline(items);
    expect(items.find((item) => item.kind === "user")?.text).toBe("帮我看一下登录闪退");
    expect(items.find((item) => item.kind === "assistant")?.text).toContain("我先读相关文件");
    expect(items.find((item) => item.kind === "tool")?.title).toBe("读取");
    expect(rows.some((row) => row.type === "tools")).toBe(true);
    expect(hasVisibleConversationTurns(items)).toBe(true);
  });

  it("uses the shipped apply/parse path so chunks are not dropped", () => {
    let timeline = [] as ReturnType<typeof applyParsedUpdate>;
    for (const update of [
      parseSessionUpdate({ sessionUpdate: "user_message_chunk", content: { type: "text", text: "继续" } }),
      parseSessionUpdate({ sessionUpdate: "agent_message_chunk", content: { type: "text", text: "好" } }),
      parseSessionUpdate({ sessionUpdate: "tool_call", toolCallId: "t", title: "read_file", status: "in_progress" }),
    ]) {
      timeline = applyParsedUpdate(timeline, update);
    }
    expect(timeline.map((item) => item.kind)).toEqual(["user", "assistant", "tool"]);
    expect(parseGrokTranscriptPayload(timeline).map((item) => item.kind)).toEqual(["user", "assistant", "tool"]);
  });
});
