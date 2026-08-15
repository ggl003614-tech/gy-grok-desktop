export type ConnectionState =
  | "checking"
  | "installing"
  | "missing"
  | "unauthenticated"
  | "subscription-required"
  | "incompatible"
  | "ready"
  | "connecting"
  | "connected"
  | "disconnected"
  | "error";

export function resumeFailureAction(error: unknown): "fallback-new" | "fatal" {
  const message = error instanceof Error ? error.message : String(error);
  if (/protocol.{0,20}(incompatible|unsupported|version)|不兼容的 ACP/i.test(message)) {
    return "fatal";
  }
  if (/subscription|entitlement|upgrade|payment|订阅|套餐/i.test(message)) {
    return "fatal";
  }
  if (/auth|login|logged.?out|unauthorized|credential|token.{0,20}expired|401|登录|认证/i.test(message)
    && !/Path not found|session missing|无法恢复/i.test(message)) {
    return "fatal";
  }
  return "fallback-new";
}

export function resumeWarningFromError(error: unknown, sessionId: string): string {
  const detail = error instanceof Error ? error.message : String(error);
  return `原线程 ${sessionId.slice(0, 8)} 无法恢复（${detail}），已在同一文件夹打开可用会话`;
}

export function disconnectRecoveryAction(payload: string): "reconnect" | "dead" {
  if (
    /连接已关闭|尚未连接|发送 ACP|eof|broken pipe|agent exited|stdout|process exited|torn|rpc/i.test(
      payload,
    )
  ) {
    return "reconnect";
  }
  return "dead";
}

export function classifyConnectionFailure(error: unknown): {
  state: ConnectionState;
  message: string;
  reconnect?: boolean;
} {
  const message = String(error);
  if (disconnectRecoveryAction(message) === "reconnect") {
    return { state: "ready", message, reconnect: true };
  }
  if (/protocol.{0,20}(incompatible|unsupported|version)|不兼容的 ACP/i.test(message)) {
    return { state: "incompatible", message };
  }
  if (/subscription|entitlement|upgrade|payment|订阅|套餐/i.test(message)) {
    return { state: "subscription-required", message };
  }
  if (/auth|login|logged.?out|unauthorized|credential|token.{0,20}expired|401|登录|认证/i.test(message)) {
    return { state: "unauthenticated", message };
  }
  return { state: "error", message };
}

export function recoverAfterDisconnect(payload: string, project?: string): {
  state: ConnectionState;
  message: string;
  reconnect: boolean;
  project?: string;
} {
  if (disconnectRecoveryAction(payload) === "reconnect" && project) {
    return {
      state: "ready",
      message: "连接已中断，正在重新连接…",
      reconnect: true,
      project,
    };
  }
  return { state: "disconnected", message: payload, reconnect: false, project };
}

export function nextConnectGeneration(current: number): number {
  return current + 1;
}

export const DISCONNECT_SETTLE_MS = 4000;

export function shouldHonorAgentDisconnect(input: {
  payload: string;
  liveGeneration: number;
  eventGeneration?: number;
  connectInFlight: boolean;
  lastConnectedAt?: number;
  now?: number;
}): "ignore" | "reconnect" | "dead" {
  if (input.connectInFlight) return "ignore";
  if (
    input.eventGeneration !== undefined
    && input.eventGeneration !== input.liveGeneration
  ) {
    return "ignore";
  }
  const now = input.now ?? Date.now();
  if (
    input.lastConnectedAt
    && now - input.lastConnectedAt < DISCONNECT_SETTLE_MS
  ) {
    return "ignore";
  }
  return disconnectRecoveryAction(input.payload);
}

export function decideThreadSwitchFailure(
  error: unknown,
  connectInFlight: boolean,
): "ignore" | "reconnect" | "fallback-new" | "fatal" {
  if (connectInFlight) return "ignore";
  const message = error instanceof Error ? error.message : String(error);
  if (disconnectRecoveryAction(message) === "reconnect") return "reconnect";
  return resumeFailureAction(error) === "fatal" ? "fatal" : "fallback-new";
}

export function planConnectFailure(
  error: unknown,
  alreadyRetried: boolean,
): { action: "retry" } | { action: "fail"; state: ConnectionState; message: string } {
  const failure = classifyConnectionFailure(error);
  if (failure.reconnect && !alreadyRetried) {
    return { action: "retry" };
  }
  if (failure.reconnect) {
    return {
      action: "fail",
      state: "ready",
      message: "连接已中断，可以重新连接",
    };
  }
  return { action: "fail", state: failure.state, message: failure.message };
}
