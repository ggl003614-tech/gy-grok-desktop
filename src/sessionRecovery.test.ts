import { describe, expect, it } from "vitest";
import {
  GrokAcpClient,
  type AcpTransport,
  type AgentEvent,
  type JsonObject,
} from "./acpClient";
import {
  classifyConnectionFailure,
  decideThreadSwitchFailure,
  disconnectRecoveryAction,
  nextConnectGeneration,
  planConnectFailure,
  recoverAfterDisconnect,
  resumeFailureAction,
  shouldHonorAgentDisconnect,
} from "./sessionRecovery";

class MockAcpTransport implements AcpTransport {
  handler?: (event: AgentEvent) => void;
  sent: JsonObject[] = [];
  starts = 0;

  async subscribe(handler: (event: AgentEvent) => void) {
    this.handler = handler;
    return () => {
      if (this.handler === handler) this.handler = undefined;
    };
  }

  async invoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
    if (command === "start_agent_advanced") this.starts += 1;
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
      },
      authenticate: { _meta: { email: "a@b.test" } },
      "session/new": { sessionId: "session-fallback" },
      "session/load": { sessionId: String(params.sessionId ?? "") },
    };
    this.emit({
      kind: "message",
      payload: JSON.stringify({
        jsonrpc: "2.0",
        id: message.id,
        result: responses[message.method] ?? {},
      }),
    });
  }
}

describe("resume fallback", () => {
  it("falls back to a usable session when required resume hits Path not found", async () => {
    expect(resumeFailureAction(new Error("Path not found"))).toBe("fallback-new");
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
              error: { message: "Path not found" },
            }),
          });
          return undefined as never;
        }
      }
      return original(command, args);
    };
    const client = new GrokAcpClient(transport);
    const info = await client.connect("C:\\project", {
      resumeSessionId: "019ffb45-dead",
      requireResume: true,
    });
    expect(info.sessionId).toBe("session-fallback");
    expect(transport.sent.some((message) => message.method === "session/new")).toBe(true);
    expect(info.resumeWarning ?? "").toMatch(/无法恢复|Path not found/i);
  });
});

describe("disconnect recovery", () => {
  it("recovers 连接已关闭 to a continuable project state instead of a dead end", () => {
    expect(disconnectRecoveryAction("连接已关闭")).toBe("reconnect");
    expect(disconnectRecoveryAction("agent stdout EOF")).toBe("reconnect");
    const recovered = recoverAfterDisconnect("连接已关闭", "E:\\projects\\grok-desktop");
    expect(recovered.state).not.toBe("disconnected");
    expect(recovered.reconnect).toBe(true);
    expect(recovered.project).toBe("E:\\projects\\grok-desktop");
    expect(classifyConnectionFailure(new Error("连接已关闭")).state).not.toBe("disconnected");
    expect(classifyConnectionFailure(new Error("连接已关闭")).reconnect).toBe(true);
  });

  it("ignores overlapping and stale EOFs so only one reconnect runs", () => {
    expect(
      shouldHonorAgentDisconnect({
        payload: "Grok Build 连接已关闭",
        liveGeneration: 2,
        eventGeneration: 2,
        connectInFlight: true,
      }),
    ).toBe("ignore");
    expect(
      shouldHonorAgentDisconnect({
        payload: "Grok Build 连接已关闭",
        liveGeneration: 3,
        eventGeneration: 2,
        connectInFlight: false,
      }),
    ).toBe("ignore");
    expect(
      shouldHonorAgentDisconnect({
        payload: "Grok Build 连接已关闭",
        liveGeneration: 3,
        eventGeneration: 3,
        connectInFlight: false,
      }),
    ).toBe("reconnect");
    expect(
      shouldHonorAgentDisconnect({
        payload: "Grok Build 连接已关闭",
        liveGeneration: 3,
        connectInFlight: false,
        lastConnectedAt: 1_000,
        now: 1_800,
      }),
    ).toBe("ignore");
    expect(
      shouldHonorAgentDisconnect({
        payload: "Grok Build 连接已关闭",
        liveGeneration: 3,
        connectInFlight: false,
        lastConnectedAt: 1_000,
        now: 6_000,
      }),
    ).toBe("reconnect");
    expect(decideThreadSwitchFailure(new Error("连接已关闭"), true)).toBe("ignore");
    expect(decideThreadSwitchFailure(new Error("Grok Build 尚未连接"), true)).toBe("ignore");
    expect(decideThreadSwitchFailure(new Error("发送 ACP 消息失败：pipe closed"), true)).toBe("ignore");
    expect(decideThreadSwitchFailure(new Error("连接已关闭"), false)).toBe("reconnect");
    expect(planConnectFailure(new Error("连接已关闭"), false)).toEqual({ action: "retry" });
    expect(planConnectFailure(new Error("连接已关闭"), true)).toMatchObject({
      action: "fail",
      state: "ready",
    });
    expect(nextConnectGeneration(4)).toBe(5);
  });

  it("does not surface the previous agent's EOF after a new connect starts", async () => {
    const transport = new MockAcpTransport();
    const client = new GrokAcpClient(transport);
    const statuses: string[] = [];
    client.onStatus = (kind, payload) => statuses.push(`${kind}:${payload}`);
    await client.connect("C:\\project");
    const original = transport.invoke.bind(transport);
    transport.invoke = async (command, args) => {
      if (command === "start_agent_advanced") {
        transport.emit({ kind: "disconnected", payload: "Grok Build 连接已关闭" });
      }
      return original(command, args);
    };
    const info = await client.connect("C:\\other");
    expect(info.sessionId).toBe("session-fallback");
    expect(statuses.filter((entry) => entry.startsWith("disconnected:"))).toEqual([]);
  });

  it("maps a dispose/send race on loadSession to 连接已关闭, not a resume miss", async () => {
    const transport = new MockAcpTransport();
    const client = new GrokAcpClient(transport);
    await client.connect("C:\\project");
    const original = transport.invoke.bind(transport);
    transport.invoke = async (command, args) => {
      if (command === "send_agent_message") {
        throw new Error("Grok Build 尚未连接");
      }
      return original(command, args);
    };
    await expect(client.loadSession("saved-session")).rejects.toThrow(/连接已关闭/);
    expect(decideThreadSwitchFailure(new Error("连接已关闭"), true)).toBe("ignore");
  });
});
