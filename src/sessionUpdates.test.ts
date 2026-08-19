import { describe, expect, it } from "vitest";
import {
  applyParsedUpdate,
  extractLocalPreviewUrls,
  friendlyToolName,
  groupTimeline,
  isSafePreviewUrl,
  parseSessionUpdate,
  redactForDisplay,
  toolSummary,
  isHarnessPrompt,
} from "./sessionUpdates";

describe("ACP session updates", () => {
  it("keeps a locally sent image message instead of appending the echo", () => {
    const local: import("./sessionUpdates").TimelineItem = {
      id: "local",
      kind: "user",
      text: "看看这张图",
      source: "local",
      images: [{ src: "data:image/png;base64,abc", alt: "shot.png" }],
    };
    const echoed = parseSessionUpdate({
      sessionUpdate: "user_message_chunk",
      content: { type: "text", text: "看看这张图" },
    });
    const timeline = applyParsedUpdate([local], echoed);
    expect(timeline).toHaveLength(1);
    expect(timeline[0].images?.[0]?.src).toContain("data:image/png");
    expect(timeline[0].text).toBe("看看这张图");
  });

  it("extracts image parts from an assistant chunk", () => {
    const parsed = parseSessionUpdate({
      sessionUpdate: "agent_message_chunk",
      content: { type: "image", mimeType: "image/png", data: "abc" },
    });
    expect(parsed.item?.images).toEqual([
      { src: "data:image/png;base64,abc" },
    ]);
  });

  it("renders the echoed user chunk once", () => {
    const parsed = parseSessionUpdate({
      sessionUpdate: "user_message_chunk",
      content: { type: "text", text: "Run the tests" },
    });
    expect(parsed).toMatchObject({
      kind: "chunk",
      item: { kind: "user", text: "Run the tests" },
    });
  });

  it("combines consecutive assistant chunks", () => {
    const first = parseSessionUpdate({
      sessionUpdate: "agent_message_chunk",
      content: { type: "text", text: "Hello" },
    });
    const second = parseSessionUpdate({
      sessionUpdate: "agent_message_chunk",
      content: { type: "text", text: " world" },
    });

    const timeline = applyParsedUpdate(applyParsedUpdate([], first), second);
    expect(timeline).toHaveLength(1);
    expect(timeline[0]).toMatchObject({ kind: "assistant", text: "Hello world" });
  });

  it("puts image_gen / read-image tool output onto the timeline", () => {
    const parsed = parseSessionUpdate({
      sessionUpdate: "tool_call_update",
      toolCallId: "img-1",
      title: "image_gen",
      status: "completed",
      content: [
        {
          type: "content",
          content: { type: "image", data: "/9j/4AAQSkZJRgABAQAAAQABAAD" },
        },
      ],
    });
    expect(parsed.item?.title).toBe("生图");
    expect(parsed.item?.images?.[0]?.src).toBe(
      "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD",
    );

    const historyStyle = parseSessionUpdate({
      sessionUpdate: "tool_call_update",
      toolCallId: "img-2",
      title: "read_file",
      status: "completed",
      images: [{ type: "image", url: "data:image/png;base64,abc" }],
    });
    expect(historyStyle.item?.images?.[0]?.src).toBe("data:image/png;base64,abc");
  });

  it("keeps generated images when a later tool update only has text", () => {
    const first = parseSessionUpdate({
      sessionUpdate: "tool_call",
      toolCallId: "img-3",
      title: "image_gen",
      status: "in_progress",
    });
    const second = parseSessionUpdate({
      sessionUpdate: "tool_call_update",
      toolCallId: "img-3",
      title: "image_gen",
      status: "completed",
      content: [{ type: "content", content: { type: "image", data: "iVBORw0KGgo" } }],
    });
    const third = parseSessionUpdate({
      sessionUpdate: "tool_call_update",
      toolCallId: "img-3",
      title: "image_gen",
      status: "completed",
      content: [{ type: "content", content: { type: "text", text: "images/1.jpg" } }],
    });
    const timeline = applyParsedUpdate(
      applyParsedUpdate(applyParsedUpdate([], first), second),
      third,
    );
    expect(timeline[0].images?.[0]?.src).toContain("data:image/png;base64,iVBORw0KGgo");
  });

  it("updates an existing tool call by id", () => {
    const pending = parseSessionUpdate({
      sessionUpdate: "tool_call",
      toolCallId: "tool-1",
      title: "Read file",
      status: "pending",
    });
    const completed = parseSessionUpdate({
      sessionUpdate: "tool_call_update",
      toolCallId: "tool-1",
      title: "Read file",
      status: "completed",
      content: [{ type: "content", content: { type: "text", text: "Done" } }],
    });

    const timeline = applyParsedUpdate(
      applyParsedUpdate([], pending),
      completed,
    );
    expect(timeline).toHaveLength(1);
    expect(timeline[0]).toMatchObject({ status: "completed", text: "Done" });
  });

  it("extracts turn token usage", () => {
    const parsed = parseSessionUpdate({
      sessionUpdate: "turn_completed",
      usage: { inputTokens: 42, outputTokens: 11, totalTokens: 53 },
    });

    expect(parsed).toMatchObject({
      kind: "usage",
      usage: { inputTokens: 42, outputTokens: 11, totalTokens: 53 },
    });
  });

  it("handles ACP context usage updates", () => {
    const parsed = parseSessionUpdate({
      sessionUpdate: "usage_update",
      used: 1200,
      size: 500000,
      cost: { amount: 0.02, currency: "USD" },
    });
    expect(parsed).toMatchObject({
      kind: "usage",
      usage: {
        contextUsed: 1200,
        contextSize: 500000,
        costAmount: 0.02,
        costCurrency: "USD",
      },
    });
    expect(parsed.usage?.totalTokens).toBeUndefined();
  });

  it("summarizes tools as one line and never dumps raw JSON", () => {
    const parsed = parseSessionUpdate({
      sessionUpdate: "tool_call",
      toolCallId: "tool-2",
      title: "run_terminal_command",
      status: "in_progress",
      rawInput: { command: "npm run dev\n--host" },
    });
    expect(parsed.item).toMatchObject({
      title: "命令",
      text: "npm run dev",
    });
    expect(parsed.item?.text.includes("{")).toBe(false);
    expect(toolSummary({ rawInput: { path: "E:\\\\web\\\\index.html" } })).toBe(
      "web/index.html",
    );
    expect(friendlyToolName("read_file")).toBe("读取");
  });

  it("hides unknown verbose protocol events", () => {
    expect(
      parseSessionUpdate({
        sessionUpdate: "some_experimental_blob",
        huge: { nested: true },
      }),
    ).toEqual({ kind: "ignore" });
  });

  it("groups consecutive tool cards", () => {
    const rows = groupTimeline([
      { id: "u", kind: "user", text: "做网站" },
      { id: "t1", kind: "tool", title: "读取", text: "a.ts", toolCallId: "1" },
      { id: "t2", kind: "tool", title: "编辑", text: "a.ts", toolCallId: "2" },
      { id: "a", kind: "assistant", text: "好了" },
    ]);
    expect(rows).toHaveLength(3);
    expect(rows[1]).toMatchObject({ type: "tools" });
    if (rows[1].type === "tools") expect(rows[1].items).toHaveLength(2);
  });

  it("extracts only local preview URLs", () => {
    expect(
      extractLocalPreviewUrls("打开 http://localhost:5173/ 和 https://example.com"),
    ).toEqual(["http://localhost:5173/"]);
    expect(isSafePreviewUrl("http://localhost:3000")).toBe(true);
    expect(isSafePreviewUrl("http://localhost.evil.com")).toBe(false);
  });

  it("redacts secrets before tool details are rendered", () => {
    expect(
      redactForDisplay({
        authorization: "Bearer abc123",
        nested: { apiKey: "secret", url: "https://x.test?a=1&token=abc" },
      }),
    ).toEqual({
      authorization: "[已隐藏]",
      nested: { apiKey: "[已隐藏]", url: "https://x.test?a=1&token=[已隐藏]" },
    });
  });

  it("processes a 10k-event streaming burst within the desktop budget", () => {
    const started = performance.now();
    let timeline: ReturnType<typeof applyParsedUpdate> = [];
    for (let index = 0; index < 10_000; index += 1) {
      timeline = applyParsedUpdate(
        timeline,
        parseSessionUpdate({
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text: "x" },
        }),
      );
    }
    const elapsed = performance.now() - started;
    expect(timeline).toHaveLength(1);
    expect(timeline[0].text).toHaveLength(10_000);
    expect(elapsed).toBeLessThan(2_000);
  });
});

describe("交替流式块的合并", () => {
  const chunk = (kind: "assistant" | "thought", text: string) => ({
    kind: "chunk" as const,
    item: { id: crypto.randomUUID(), kind, text },
  });

  it("正文被推理打断后仍并回同一条", () => {
    let items: TimelineItem[] = [];
    // Grok 实际的顺序：正文 → 推理 → 正文 → 推理 → 正文
    items = applyParsedUpdate(items, chunk("assistant", "索引："));
    items = applyParsedUpdate(items, chunk("thought", "在找文件"));
    items = applyParsedUpdate(items, chunk("assistant", "F:\Personal"));
    items = applyParsedUpdate(items, chunk("thought", "拼路径"));
    items = applyParsedUpdate(items, chunk("assistant", "\docs\memory"));

    const assistant = items.filter((i) => i.kind === "assistant");
    const thought = items.filter((i) => i.kind === "thought");
    expect(assistant).toHaveLength(1);
    expect(thought).toHaveLength(1);
    expect(assistant[0].text).toBe("索引：F:\Personal\docs\memory");
    expect(thought[0].text).toBe("在找文件拼路径");
  });

  it("用户消息之后另起一条，不并到上一轮", () => {
    let items: TimelineItem[] = [];
    items = applyParsedUpdate(items, chunk("assistant", "第一轮"));
    items = [...items, { id: "u1", kind: "user", text: "再来" }];
    items = applyParsedUpdate(items, chunk("assistant", "第二轮"));

    const assistant = items.filter((i) => i.kind === "assistant");
    expect(assistant).toHaveLength(2);
    expect(assistant[1].text).toBe("第二轮");
  });

  it("工具调用会切断合并", () => {
    let items: TimelineItem[] = [];
    items = applyParsedUpdate(items, chunk("assistant", "先读文件"));
    items = [...items, { id: "t1", kind: "tool", text: "read", status: "completed" }];
    items = applyParsedUpdate(items, chunk("assistant", "读完了"));

    expect(items.filter((i) => i.kind === "assistant")).toHaveLength(2);
  });
});

describe("goal 内部指令识别", () => {
  it("认出 Summarizer / Plan Writer / 验证器提示词", () => {
    // 原文来自用户截图和本机被污染的会话标题
    expect(isHarnessPrompt(
      "You are the Goal Summarizer for the xAI Grok Build harness. The goal has just been VERIFIED as achieved.",
    )).toBe(true);
    expect(isHarnessPrompt("You are the Goal Plan Writer for the harness. Write the plan.")).toBe(true);
    expect(isHarnessPrompt("You are an **adversarial verifier** for goal completion claims.")).toBe(true);
  });

  it("真实用户消息不被误伤", () => {
    expect(isHarnessPrompt("帮我改一下预览面板")).toBe(false);
    expect(isHarnessPrompt("You are welcome to review my code")).toBe(false);
    // 用户就是在聊角色扮演也不该折叠 —— 没有 harness 特征词
    expect(isHarnessPrompt("You are a helpful assistant, please answer in Chinese")).toBe(false);
  });

  it("user_message_chunk 解析时打上 harness 标记", () => {
    const parsed = parseSessionUpdate({
      sessionUpdate: "user_message_chunk",
      content: { type: "text", text: "You are the Goal Summarizer for the xAI Grok Build harness. Recap." },
    });
    expect(parsed.kind).toBe("chunk");
    if (parsed.kind === "chunk") expect(parsed.item.harness).toBe(true);
    const normal = parseSessionUpdate({
      sessionUpdate: "user_message_chunk",
      content: { type: "text", text: "继续修那个按钮" },
    });
    if (normal.kind === "chunk") expect(normal.item.harness).toBeUndefined();
  });
});
