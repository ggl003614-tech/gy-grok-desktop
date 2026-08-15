import { describe, expect, it } from "vitest";
import {
  buildPromptParts,
  buildSetSessionModelParams,
  GrokAcpClient,
  normalizeModels,
  sessionOpenMethod,
  type AcpTransport,
  type AgentEvent,
  type JsonObject,
} from "./acpClient";

class MockAcpTransport implements AcpTransport {
  handler?: (event: AgentEvent) => void;
  sent: JsonObject[] = [];
  starts = 0;
  lastStart?: JsonObject;

  async subscribe(handler: (event: AgentEvent) => void) {
    this.handler = handler;
    return () => {
      if (this.handler === handler) this.handler = undefined;
    };
  }

  async invoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
    if (command === "start_agent_advanced") {
      this.starts += 1;
      this.lastStart = (args?.options ?? {}) as JsonObject;
    }
    if (command === "run_cli_probe") {
      return {
        kind: "models",
        args: ["models"],
        success: true,
        stdout: "Default model: grok-4.6\n\nAvailable models:\n  * grok-4.6 (default)\n  - grok-4.5\n",
        stderr: "",
        truncated: false,
      } as T;
    }
    if (command === "send_agent_message") {
      const message = JSON.parse(String(args?.message ?? "{}")) as JsonObject;
      this.sent.push(message);
      this.reply(message);
    }
    return undefined as T;
  }

  emit(event: AgentEvent) {
    this.handler?.(event);
  }

  private message(value: JsonObject) {
    this.emit({ kind: "message", payload: JSON.stringify(value) });
  }

  private reply(message: JsonObject) {
    if (message.id === undefined || typeof message.method !== "string") return;
    const params = (message.params ?? {}) as JsonObject;
    const responses: Record<string, JsonObject> = {
      initialize: {
        protocolVersion: 1,
        authMethods: [{ id: "cached_token" }],
        agentCapabilities: {
          loadSession: true,
          sessionCapabilities: { list: {}, close: {}, delete: {} },
        },
        _meta: { agentVersion: "test-agent" },
      },
      authenticate: {
        _meta: {
          email: "account@example.test",
          subscription_tier: "x_premium",
          auth_mode: "cached_token",
        },
      },
      "session/new": {
        sessionId: "session-new",
        models: {
          currentModelId: "grok-4.6",
          availableModels: [
            {
              modelId: "grok-4.6",
              name: "Grok 4.6",
              _meta: {
                totalContextTokens: 500_000,
                supportsReasoningEffort: true,
                reasoningEffort: "high",
                reasoningEfforts: [
                  { id: "high", value: "high", label: "High" },
                  { id: "low", value: "low", label: "Low" },
                ],
              },
            },
          ],
        },
      },
      "session/set_model": {
        _meta: { model: { Ok: String(params.modelId ?? "") } },
      },
      "session/list": {
        sessions: [
          {
            sessionId: "saved-session",
            cwd: "C:\\project",
            title: "Saved task",
          },
        ],
      },
      "session/load": {
        sessionId: String(params.sessionId ?? "saved-session"),
        models: {
          currentModelId: "grok-4.6",
          availableModels: [
            { modelId: "grok-4.6", name: "Grok 4.6" },
          ],
        },
      },
      "session/resume": {},
      "session/close": {},
      "session/delete": {},
      "session/set_mode": {
        currentModeId: String(params.modeId ?? "default"),
        availableModes: [{ id: "default", name: "Default" }],
      },
      "session/prompt": { stopReason: "end_turn" },
    };
    if (message.method === "session/load") {
      this.message({
        jsonrpc: "2.0",
        method: "session/update",
        params: {
          update: {
            sessionUpdate: "user_message_chunk",
            content: { type: "text", text: "Recovered" },
          },
        },
      });
    }
    if (message.method === "session/prompt") {
      this.message({
        jsonrpc: "2.0",
        method: "session/update",
        params: {
          update: {
            sessionUpdate: "agent_message_chunk",
            content: { type: "text", text: "Done" },
          },
        },
      });
    }
    this.message({
      jsonrpc: "2.0",
      id: message.id,
      result: responses[message.method] ?? {},
    });
  }
}

describe("Grok ACP model capability detection", () => {
  it("reads the model-specific reasoning effort catalog", () => {
    const state = normalizeModels({
      currentModelId: "grok-4.6",
      availableModels: [
        {
          modelId: "grok-4.6",
          name: "Grok 4.6",
          _meta: {
            totalContextTokens: 500_000,
            supportsReasoningEffort: true,
            reasoningEffort: "high",
            reasoningEfforts: [
              { id: "xhigh", value: "xhigh", label: "Extra high" },
              { id: "low", value: "low", label: "Low" },
            ],
          },
        },
      ],
    });

    expect(state.currentModelId).toBe("grok-4.6");
    expect(state.availableModels[0]).toMatchObject({
      totalContextTokens: 500_000,
      supportsReasoningEffort: true,
      reasoningEffort: "high",
    });
    expect(state.availableModels[0].reasoningEfforts.map((entry) => entry.value)).toEqual([
      "xhigh",
      "low",
    ]);
  });

  it("sends reasoning effort through the xAI ACP metadata field", () => {
    expect(buildSetSessionModelParams("session-1", " grok-4.6 ", " low ")).toEqual({
      sessionId: "session-1",
      modelId: "grok-4.6",
      _meta: { reasoningEffort: "low" },
    });
  });

  it("omits reasoning metadata when the model uses its default", () => {
    expect(buildSetSessionModelParams("session-1", "grok-4.5")).toEqual({
      sessionId: "session-1",
      modelId: "grok-4.5",
    });
  });
});

describe("prompt attachments", () => {
  it("mentions copied files and embeds text without requiring image support", () => {
    const parts = buildPromptParts(
      "看看这些",
      [
        {
          name: "shot.png",
          storedPath: ".grok-desk/inbox/1-shot.png",
          absolutePath: "E:\\proj\\.grok-desk\\inbox\\1-shot.png",
          mime: "image/png",
          kind: "image",
          dataUrl: "data:image/png;base64,abc",
        },
        {
          name: "note.txt",
          storedPath: ".grok-desk/inbox/2-note.txt",
          absolutePath: "E:\\proj\\.grok-desk\\inbox\\2-note.txt",
          mime: "text/plain",
          kind: "text",
          text: "hello",
        },
      ],
      false,
    );
    expect(parts[0]).toMatchObject({ type: "text" });
    expect(String((parts[0] as { text: string }).text)).toContain(
      ".grok-desk/inbox/1-shot.png",
    );
    expect(parts.some((part) => part.type === "image")).toBe(false);
    expect(parts).toContainEqual({
      type: "resource",
      resource: {
        uri: "file:///E:/proj/.grok-desk/inbox/2-note.txt",
        mimeType: "text/plain",
        text: "hello",
      },
    });
  });

  it("embeds supported images without the path-only caption", () => {
    const parts = buildPromptParts(
      "看看这张图",
      [
        {
          name: "shot.png",
          storedPath: ".grok-desk/inbox/1-shot.png",
          absolutePath: "E:/proj/.grok-desk/inbox/1-shot.png",
          mime: "image/png",
          kind: "image",
          dataUrl: "data:image/png;base64,abc",
        },
      ],
      true,
    );
    expect(parts[0]).toMatchObject({ type: "text", text: "看看这张图" });
    expect(parts).toContainEqual({ type: "image", mimeType: "image/png", data: "abc" });
  });
});

describe("session resume", () => {
  it("prefers session/load when a previous session id exists", () => {
    expect(
      sessionOpenMethod("abc", { loadSession: true, resumeSession: true }),
    ).toBe("session/load");
    expect(
      sessionOpenMethod("abc", { loadSession: false, resumeSession: true }),
    ).toBe("session/resume");
    expect(
      sessionOpenMethod(undefined, { loadSession: true, resumeSession: true }),
    ).toBe("session/new");
  });

  it("reconnects by loading the previous session instead of opening a new one", async () => {
    const transport = new MockAcpTransport();
    const client = new GrokAcpClient(transport);
    const info = await client.connect("C:\\project", { resumeSessionId: "saved-session" });
    expect(info.sessionId).toBe("saved-session");
    expect(transport.sent.some((message) => message.method === "session/load")).toBe(true);
    expect(transport.sent.some((message) => message.method === "session/new")).toBe(false);
  });

  it("opens a usable fallback session when required resume cannot load", async () => {
    const transport = new MockAcpTransport();
    const original = transport.invoke.bind(transport);
    transport.invoke = async (command, args) => {
      if (command === "send_agent_message") {
        const message = JSON.parse(String(args?.message ?? "{}")) as JsonObject;
        if (message.method === "session/load") {
          transport.emit({
            kind: "message",
            payload: JSON.stringify({
              jsonrpc: "2.0",
              id: message.id,
              error: { message: "session missing" },
            }),
          });
          return undefined as never;
        }
      }
      return original(command, args);
    };
    const client = new GrokAcpClient(transport);
    const info = await client.connect("C:\\project", {
      resumeSessionId: "missing",
      requireResume: true,
    });
    expect(info.sessionId).toBe("session-new");
    expect(transport.sent.some((message) => message.method === "session/new")).toBe(true);
    expect(info.resumeWarning).toMatch(/无法恢复|session missing/i);
  });
});

describe("ACP process model pinning", () => {
  it("starts the agent without --model and still exposes the CLI 4.6 catalog", async () => {
    const transport = new MockAcpTransport();
    const client = new GrokAcpClient(transport);
    const info = await client.connect("C:\\project", { model: "grok-4.5" });
    expect(transport.lastStart).toMatchObject({
      cwd: "C:\\project",
      alwaysApprove: false,
      debug: false,
    });
    expect(transport.lastStart).not.toHaveProperty("model");
    expect(transport.lastStart).not.toHaveProperty("reasoningEffort");
    expect(info.models.map((model) => model.modelId)).toEqual([
      "grok-4.6",
      "grok-4.5",
    ]);
    expect(info.model).toBe("grok-4.5");
    expect(
      transport.sent.some(
        (message) =>
          message.method === "session/set_model" &&
          (message.params as JsonObject | undefined)?.modelId === "grok-4.5",
      ),
    ).toBe(true);
  });
});

describe("Grok ACP mocked end-to-end transport", () => {
  it("covers authentication, subscription, streaming, session recovery and configuration", async () => {
    const transport = new MockAcpTransport();
    const client = new GrokAcpClient(transport);
    const notifications: string[] = [];
    client.onNotification = (method) => notifications.push(method);

    const info = await client.connect("C:\\project");
    expect(transport.lastStart).not.toHaveProperty("model");
    expect(info).toMatchObject({
      sessionId: "session-new",
      model: "grok-4.6",
      subscriptionTier: "x_premium",
      authMode: "cached_token",
      capabilities: { loadSession: true, listSessions: true, deleteSession: true },
    });
    expect(info.models.map((model) => model.modelId)).toEqual([
      "grok-4.6",
      "grok-4.5",
    ]);
    expect(info.models[0].reasoningEfforts.map((entry) => entry.value)).toEqual([
      "high",
      "low",
    ]);

    expect(await client.listSessions()).toEqual([
      expect.objectContaining({ sessionId: "saved-session", title: "Saved task" }),
    ]);
    await client.loadSession("saved-session");
    await client.prompt("Run");
    expect(notifications).toEqual(["session/update", "session/update"]);

    expect(await client.setSessionModel("grok-4.6", "low")).toEqual({
      modelId: "grok-4.6",
      reasoningEffort: "low",
    });
    expect(await client.setSessionMode("default")).toMatchObject({
      currentModeId: "default",
    });
    await client.cancel();
    expect(transport.sent.at(-1)).toMatchObject({
      method: "session/cancel",
      params: { sessionId: "saved-session" },
    });
    await client.deleteSession("saved-session");
  });

  it("handles permissions, malformed events, disconnects and reconnects", async () => {
    const transport = new MockAcpTransport();
    const client = new GrokAcpClient(transport);
    const errors: string[] = [];
    const permissions: string[] = [];
    client.onStatus = (kind, payload) => errors.push(`${kind}:${payload}`);
    client.onPermission = (request) => permissions.push(String(request.requestId));

    await client.connect("C:\\project");
    transport.emit({ kind: "message", payload: "{not-json" });
    transport.emit({
      kind: "message",
      payload: JSON.stringify({
        jsonrpc: "2.0",
        id: 99,
        method: "session/request_permission",
        params: {
          sessionId: "session-new",
          toolCall: { title: "Read file" },
          options: [{ optionId: "allow_once", name: "Allow once" }],
        },
      }),
    });
    await client.respondPermission(99, "allow_once");
    transport.emit({ kind: "disconnected", payload: "agent exited" });

    expect(errors.some((entry) => entry.startsWith("error:"))).toBe(true);
    expect(errors).toContain("disconnected:agent exited");
    expect(permissions).toEqual(["99"]);
    expect(transport.sent.at(-1)).toMatchObject({
      id: 99,
      result: {
        outcome: { outcome: "selected", optionId: "allow_once" },
      },
    });

    await client.connect("C:\\project");
    expect(transport.starts).toBe(2);
  });
});
