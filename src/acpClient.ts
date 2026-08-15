import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import {
  agentProcessStartOptions,
  mergeModelCatalog,
  parseGrokModelsList,
  resolvePreferredSessionModel,
} from "./grokModels";
import { resumeFailureAction, resumeWarningFromError } from "./sessionRecovery";

export type JsonObject = Record<string, unknown>;

export interface AgentEvent {
  kind: "message" | "log" | "error" | "started" | "disconnected";
  payload: string;
}

export interface PermissionOption {
  optionId: string;
  name: string;
  kind?: string;
}

export interface PermissionRequest {
  requestId: number | string;
  sessionId: string;
  toolCall: JsonObject;
  options: PermissionOption[];
}

export interface ConnectionInfo {
  sessionId: string;
  model: string;
  models: GrokModel[];
  email?: string;
  subscriptionTier?: string;
  authMode?: string;
  teamName?: string;
  isZeroDataRetention?: boolean;
  codingDataRetentionOptOut?: boolean;
  agentVersion?: string;
  capabilities: AgentCapabilities;
  configOptions: SessionConfigOption[];
  modes?: SessionModeState;
  resumeWarning?: string;
}

export interface ActiveModelSelection {
  modelId: string;
  reasoningEffort?: string;
}

export interface ReasoningEffortOption {
  id: string;
  value: string;
  label: string;
  description?: string;
  isDefault: boolean;
}

export interface GrokModel {
  modelId: string;
  name: string;
  description?: string;
  totalContextTokens?: number;
  supportsReasoningEffort: boolean;
  reasoningEffort?: string;
  reasoningEfforts: ReasoningEffortOption[];
}

export interface AgentCapabilities {
  loadSession: boolean;
  listSessions: boolean;
  resumeSession: boolean;
  closeSession: boolean;
  deleteSession: boolean;
  promptImage: boolean;
  promptAudio: boolean;
  embeddedContext: boolean;
  mcpHttp: boolean;
  mcpSse: boolean;
}

export interface SessionConfigOption extends JsonObject {
  id: string;
  name: string;
  category?: string;
  type: "select" | "boolean";
  currentValue: string | boolean;
  options?: JsonObject[];
}

export interface SessionModeState extends JsonObject {
  currentModeId: string;
  availableModes: Array<{
    id: string;
    name: string;
    description?: string;
  }>;
}

export interface RemoteSession {
  sessionId: string;
  cwd?: string;
  title?: string;
  updatedAt?: string;
  summary?: string;
  numChatMessages?: number;
  contextTokensUsed?: number;
  contextWindowTokens?: number;
  contextWindowUsage?: number;
}

export type PromptPart =
  | { type: "text"; text: string }
  | { type: "image"; mimeType: string; data: string }
  | {
      type: "resource";
      resource: { uri: string; mimeType?: string; text?: string };
    }
  | { type: "resource_link"; uri: string; name?: string; mimeType?: string };

export interface ConnectOptions {
  model?: string;
  reasoningEffort?: string;
  alwaysApprove?: boolean;
  permissionMode?: string;
  leader?: boolean;
  debug?: boolean;
  resumeSessionId?: string;
  requireResume?: boolean;
}

export function sessionOpenMethod(
  resumeSessionId: string | undefined,
  capabilities: Pick<AgentCapabilities, "loadSession" | "resumeSession">,
) {
  if (resumeSessionId && capabilities.loadSession) return "session/load" as const;
  if (resumeSessionId && capabilities.resumeSession) return "session/resume" as const;
  return "session/new" as const;
}

interface PendingRequest {
  resolve: (result: JsonObject) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

interface RpcMessage extends JsonObject {
  jsonrpc: "2.0";
  id?: number | string;
  method?: string;
  params?: JsonObject;
  result?: JsonObject;
  error?: { code?: number; message?: string; data?: unknown };
}

type NotificationHandler = (method: string, params: JsonObject) => void;
type PermissionHandler = (request: PermissionRequest) => void;
type StatusHandler = (kind: AgentEvent["kind"], payload: string) => void;

export interface AcpTransport {
  invoke<T>(command: string, args?: Record<string, unknown>): Promise<T>;
  subscribe(handler: (event: AgentEvent) => void): Promise<UnlistenFn>;
}

const tauriTransport: AcpTransport = {
  invoke: (command, args) => invoke(command, args),
  subscribe: (handler) =>
    listen<AgentEvent>("grok-agent-event", (event) => handler(event.payload)),
};

function object(value: unknown): JsonObject {
  return value && typeof value === "object" ? (value as JsonObject) : {};
}

function boolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function normalizeCapabilities(value: unknown): AgentCapabilities {
  const capabilities = object(value);
  const prompt = object(capabilities.promptCapabilities);
  const mcp = object(capabilities.mcpCapabilities);
  const sessions = object(capabilities.sessionCapabilities);
  return {
    loadSession: capabilities.loadSession === true,
    listSessions: "list" in sessions,
    resumeSession: "resume" in sessions,
    closeSession: "close" in sessions,
    deleteSession: "delete" in sessions,
    promptImage: prompt.image === true,
    promptAudio: prompt.audio === true,
    embeddedContext: prompt.embeddedContext === true,
    mcpHttp: mcp.http === true,
    mcpSse: mcp.sse === true,
  };
}

export function normalizeModels(value: unknown): {
  currentModelId: string;
  availableModels: GrokModel[];
} {
  const state = object(value);
  const availableModels = Array.isArray(state.availableModels)
    ? state.availableModels.map((entry): GrokModel => {
        const model = object(entry);
        const meta = object(model._meta);
        const efforts = Array.isArray(meta.reasoningEfforts)
          ? meta.reasoningEfforts.map((entry): ReasoningEffortOption => {
              const effort = object(entry);
              return {
                id: String(effort.id ?? effort.value ?? ""),
                value: String(effort.value ?? effort.id ?? ""),
                label: String(effort.label ?? effort.value ?? effort.id ?? ""),
                description:
                  typeof effort.description === "string"
                    ? effort.description
                    : undefined,
                isDefault: effort.default === true,
              };
            })
          : [];
        return {
          modelId: String(model.modelId ?? ""),
          name: String(model.name ?? model.modelId ?? "Unknown model"),
          description:
            typeof model.description === "string" ? model.description : undefined,
          totalContextTokens:
            typeof meta.totalContextTokens === "number"
              ? meta.totalContextTokens
              : undefined,
          supportsReasoningEffort: meta.supportsReasoningEffort === true,
          reasoningEffort:
            typeof meta.reasoningEffort === "string"
              ? meta.reasoningEffort
              : undefined,
          reasoningEfforts: efforts.filter((effort) => effort.value),
        };
      })
    : [];
  return {
    currentModelId: String(state.currentModelId ?? availableModels[0]?.modelId ?? ""),
    availableModels: availableModels.filter((model) => model.modelId),
  };
}

export function buildSetSessionModelParams(
  sessionId: string,
  modelId: string,
  reasoningEffort?: string,
): JsonObject {
  const normalizedModelId = modelId.trim();
  const normalizedEffort = reasoningEffort?.trim() || undefined;
  return {
    sessionId,
    modelId: normalizedModelId,
    ...(normalizedEffort
      ? { _meta: { reasoningEffort: normalizedEffort } }
      : {}),
  };
}

function normalizeConfigOptions(value: unknown): SessionConfigOption[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => object(entry))
    .filter((entry) => typeof entry.id === "string")
    .map((entry) => entry as SessionConfigOption);
}

export class GrokAcpClient {
  private nextId = 1;
  private pending = new Map<number | string, PendingRequest>();
  private unlisten?: UnlistenFn;
  private cwd = "";
  private sessionId = "";
  private lastResumeWarning = "";
  private generation = 0;
  private suppressDisconnect = false;
  private readonly transport: AcpTransport;

  get connectGeneration() {
    return this.generation;
  }

  constructor(transport: AcpTransport = tauriTransport) {
    this.transport = transport;
  }

  onNotification?: NotificationHandler;
  onPermission?: PermissionHandler;
  onStatus?: StatusHandler;

  async connect(cwd: string, options: ConnectOptions = {}): Promise<ConnectionInfo> {
    const generation = ++this.generation;
    this.suppressDisconnect = true;
    await this.disposeKeepingGeneration();
    this.lastResumeWarning = "";
    this.cwd = cwd;
    this.unlisten = await this.transport.subscribe((event) => {
      if (this.generation !== generation) return;
      this.handleAgentEvent(event);
    });

    try {
    const modelsProbe = this.transport
      .invoke<{ stdout?: string }>("run_cli_probe", { request: { kind: "models" } })
      .catch(() => undefined);
    await this.transport.invoke("start_agent_advanced", {
      options: agentProcessStartOptions(cwd, options),
    });

    const init = await this.request(
      "initialize",
      {
        protocolVersion: 1,
        // Grok owns file and terminal execution. We only host the UI.
        clientCapabilities: {},
      },
      30_000,
    );
    const negotiatedProtocol = Number(init.protocolVersion ?? 1);
    if (negotiatedProtocol !== 1) {
      throw new Error(
        `Grok Build 返回了不兼容的 ACP 协议版本：${negotiatedProtocol}（GY Grok 需要 v1）`,
      );
    }

    const authMethods = Array.isArray(init.authMethods)
      ? (init.authMethods as JsonObject[])
      : [];
    const authIds = authMethods.map((method) => String(method.id ?? ""));
    const methodId = authIds.includes("cached_token")
      ? "cached_token"
      : authIds.includes("grok.com")
        ? "grok.com"
        : authIds[0];

    if (!methodId) {
      throw new Error("没有可用的 Grok 登录方式，请先在终端运行 grok login");
    }

    const auth = await this.request(
      "authenticate",
      { methodId, _meta: { headless: methodId === "cached_token" } },
      180_000,
    );
    const capabilities = normalizeCapabilities(init.agentCapabilities);
    const resumeSessionId = options.resumeSessionId?.trim();
    const openMethod = sessionOpenMethod(resumeSessionId, capabilities);
    let session: JsonObject = {};
    if (openMethod !== "session/new" && resumeSessionId) {
      try {
        session = await this.request(
          openMethod,
          { sessionId: resumeSessionId, cwd, mcpServers: [] },
          60_000,
        );
        this.sessionId = resumeSessionId;
      } catch (error) {
        if (resumeFailureAction(error) === "fatal") {
          throw error instanceof Error ? error : new Error(String(error));
        }
        this.lastResumeWarning = resumeWarningFromError(error, resumeSessionId);
        session = {};
        this.sessionId = "";
      }
    }
    if (!this.sessionId) {
      session = await this.request(
        "session/new",
        { cwd, mcpServers: [] },
        60_000,
      );
      this.sessionId = String(session.sessionId ?? "");
    }
    if (!this.sessionId) throw new Error("Grok Build 未返回会话 ID");

    const meta = object(init._meta);
    const authMeta = object(auth._meta);
    const modelState = normalizeModels(session.models);
    const cliModels = parseGrokModelsList(String((await modelsProbe)?.stdout ?? ""));
    const catalog = mergeModelCatalog(modelState.availableModels, cliModels.modelIds);
    let activeSelection: ActiveModelSelection = {
      modelId: modelState.currentModelId || cliModels.defaultModelId,
      reasoningEffort: modelState.availableModels.find(
        (model) => model.modelId === modelState.currentModelId,
      )?.reasoningEffort,
    };
    const preferred = resolvePreferredSessionModel(
      options.model,
      catalog.map((model) => model.modelId),
      activeSelection.modelId,
    );
    if (preferred && (preferred !== activeSelection.modelId || options.reasoningEffort)) {
      try {
        activeSelection = await this.setSessionModel(preferred, options.reasoningEffort);
      } catch {
        // Keep the CLI/session default if the leftover preference is gone.
      }
    }
    const availableModels = catalog.map((model) =>
      model.modelId === activeSelection.modelId && activeSelection.reasoningEffort
        ? { ...model, reasoningEffort: activeSelection.reasoningEffort }
        : model,
    );
    return {
      sessionId: this.sessionId,
      model: activeSelection.modelId || cliModels.defaultModelId || "Grok Build",
      models: availableModels,
      email: typeof authMeta.email === "string" ? authMeta.email : undefined,
      subscriptionTier:
        typeof authMeta.subscription_tier === "string"
          ? authMeta.subscription_tier
          : undefined,
      authMode:
        typeof authMeta.auth_mode === "string" ? authMeta.auth_mode : undefined,
      teamName:
        typeof authMeta.team_name === "string" ? authMeta.team_name : undefined,
      isZeroDataRetention: boolean(authMeta.is_zdr),
      codingDataRetentionOptOut: boolean(
        authMeta.coding_data_retention_opt_out,
      ),
      agentVersion:
        typeof meta.agentVersion === "string" ? meta.agentVersion : undefined,
      capabilities,
      configOptions: normalizeConfigOptions(session.configOptions),
      modes: session.modes as SessionModeState | undefined,
      resumeWarning: this.lastResumeWarning || undefined,
    };
    } finally {
      if (this.generation === generation) this.suppressDisconnect = false;
    }
  }

  async newSession(): Promise<string> {
    if (!this.cwd) throw new Error("请先选择项目目录");
    const session = await this.request(
      "session/new",
      { cwd: this.cwd, mcpServers: [] },
      60_000,
    );
    this.sessionId = String(session.sessionId ?? "");
    return this.sessionId;
  }

  async listSessions(): Promise<RemoteSession[]> {
    if (!this.cwd) throw new Error("No workspace is connected");
    const sessions: RemoteSession[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < 20; page += 1) {
      const result = await this.request(
        "session/list",
        { cwd: this.cwd, ...(cursor ? { cursor } : {}) },
        30_000,
      );
      if (Array.isArray(result.sessions)) {
        for (const entry of result.sessions) {
          const session = object(entry);
          const meta = object(session._meta);
          sessions.push({
            sessionId: String(session.sessionId ?? ""),
            cwd: typeof session.cwd === "string" ? session.cwd : undefined,
            title:
              typeof session.title === "string"
                ? session.title
                : typeof meta.title === "string"
                  ? meta.title
                  : undefined,
            updatedAt:
              typeof session.updatedAt === "string"
                ? session.updatedAt
                : undefined,
          });
        }
      }
      cursor = typeof result.nextCursor === "string" ? result.nextCursor : undefined;
      if (!cursor) break;
    }
    return sessions.filter((session) => session.sessionId);
  }

  async loadSession(sessionId: string): Promise<void> {
    if (!this.cwd) throw new Error("No workspace is connected");
    await this.request(
      "session/load",
      { sessionId, cwd: this.cwd, mcpServers: [] },
      60_000,
    );
    this.sessionId = sessionId;
  }

  async resumeSession(sessionId: string): Promise<void> {
    if (!this.cwd) throw new Error("No workspace is connected");
    await this.request(
      "session/resume",
      { sessionId, cwd: this.cwd, mcpServers: [] },
      60_000,
    );
    this.sessionId = sessionId;
  }

  async closeSession(sessionId = this.sessionId): Promise<void> {
    if (!sessionId) return;
    await this.request("session/close", { sessionId }, 30_000);
    if (sessionId === this.sessionId) this.sessionId = "";
  }

  async deleteSession(sessionId: string): Promise<void> {
    if (!sessionId) throw new Error("Session id is required");
    await this.request("session/delete", { sessionId }, 30_000);
    if (sessionId === this.sessionId) this.sessionId = "";
  }

  async setSessionMode(modeId: string): Promise<SessionModeState> {
    if (!this.sessionId) throw new Error("No Grok session is connected");
    const result = await this.request(
      "session/set_mode",
      { sessionId: this.sessionId, modeId },
      30_000,
    );
    return {
      currentModeId: String(result.currentModeId ?? modeId),
      availableModes: Array.isArray(result.availableModes)
        ? (result.availableModes as SessionModeState["availableModes"])
        : [],
    };
  }

  async setSessionConfigOption(
    configId: string,
    value: string | boolean,
  ): Promise<SessionConfigOption[]> {
    if (!this.sessionId) throw new Error("No Grok session is connected");
    const result = await this.request(
      "session/set_config_option",
      {
        sessionId: this.sessionId,
        configId,
        value,
        ...(typeof value === "boolean" ? { type: "boolean" } : {}),
      },
      30_000,
    );
    return normalizeConfigOptions(result.configOptions);
  }

  async setSessionModel(
    modelId: string,
    reasoningEffort?: string,
  ): Promise<ActiveModelSelection> {
    if (!this.sessionId) throw new Error("No Grok session is connected");
    const normalizedModelId = modelId.trim();
    if (!normalizedModelId) throw new Error("Model id is required");
    const normalizedEffort = reasoningEffort?.trim() || undefined;
    const result = await this.request(
      "session/set_model",
      buildSetSessionModelParams(
        this.sessionId,
        normalizedModelId,
        normalizedEffort,
      ),
      30_000,
    );
    const meta = object(result._meta);
    const modelResult = object(meta.model);
    return {
      modelId:
        typeof meta.model === "string"
          ? meta.model
          : typeof modelResult.Ok === "string"
            ? modelResult.Ok
            : normalizedModelId,
      reasoningEffort: normalizedEffort,
    };
  }

  async prompt(input: string | PromptPart[]): Promise<JsonObject> {
    if (!this.sessionId) throw new Error("Grok 会话尚未连接");
    const prompt = typeof input === "string" ? [{ type: "text", text: input }] : input;
    return this.request(
      "session/prompt",
      {
        sessionId: this.sessionId,
        prompt,
      },
      60 * 60 * 1000,
    );
  }

  async cancel(): Promise<void> {
    if (!this.sessionId) return;
    await this.send({
      jsonrpc: "2.0",
      method: "session/cancel",
      params: { sessionId: this.sessionId },
    });
  }

  async respondPermission(
    requestId: number | string,
    optionId?: string,
  ): Promise<void> {
    const outcome = optionId
      ? { outcome: "selected", optionId }
      : { outcome: "cancelled" };
    await this.send({
      jsonrpc: "2.0",
      id: requestId,
      result: { outcome },
    });
  }

  async dispose(): Promise<void> {
    this.generation += 1;
    this.suppressDisconnect = false;
    await this.disposeKeepingGeneration();
  }

  private async disposeKeepingGeneration(): Promise<void> {
    this.unlisten?.();
    this.unlisten = undefined;
    this.sessionId = "";
    this.cwd = "";
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error("连接已关闭"));
    }
    this.pending.clear();
    try {
      await this.transport.invoke("stop_agent");
    } catch {
      // The app may be closing and the Tauri bridge may already be unavailable.
    }
  }

  private async request(
    method: string,
    params: JsonObject,
    timeoutMs: number,
  ): Promise<JsonObject> {
    const id = this.nextId++;
    const response = new Promise<JsonObject>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${method} 请求超时`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
    });
    try {
      await this.send({ jsonrpc: "2.0", id, method, params });
    } catch (error) {
      const pending = this.pending.get(id);
      if (pending) {
        clearTimeout(pending.timer);
        this.pending.delete(id);
      }
      const message = error instanceof Error ? error.message : String(error);
      if (/尚未连接|发送 ACP|连接已关闭|eof|broken pipe/i.test(message)) {
        throw new Error("连接已关闭");
      }
      throw error instanceof Error ? error : new Error(message);
    }
    return response;
  }

  private async send(message: RpcMessage): Promise<void> {
    await this.transport.invoke("send_agent_message", {
      message: JSON.stringify(message),
    });
  }

  private handleAgentEvent(event: AgentEvent) {
    if (event.kind !== "message") {
      if (event.kind === "disconnected" && this.suppressDisconnect) return;
      this.onStatus?.(event.kind, event.payload);
      return;
    }

    let message: RpcMessage;
    try {
      message = JSON.parse(event.payload) as RpcMessage;
    } catch {
      this.onStatus?.(
        "error",
        `无法解析 Grok 消息（${event.payload.length} 字节，原始内容未显示）`,
      );
      return;
    }

    if (message.method && message.id !== undefined) {
      this.handleAgentRequest(message);
      return;
    }

    if (message.method) {
      this.onNotification?.(message.method, message.params ?? {});
      return;
    }

    if (message.id !== undefined) {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      clearTimeout(pending.timer);
      this.pending.delete(message.id);
      if (message.error) {
        pending.reject(
          new Error(message.error.message ?? JSON.stringify(message.error)),
        );
      } else {
        pending.resolve(message.result ?? {});
      }
    }
  }

  private handleAgentRequest(message: RpcMessage) {
    if (message.method === "session/request_permission") {
      const params = message.params ?? {};
      this.onPermission?.({
        requestId: message.id!,
        sessionId: String(params.sessionId ?? ""),
        toolCall: (params.toolCall ?? {}) as JsonObject,
        options: Array.isArray(params.options)
          ? (params.options as PermissionOption[])
          : [],
      });
      return;
    }

    void this.send({
      jsonrpc: "2.0",
      id: message.id,
      error: {
        code: -32601,
        message: `GY Grok 不支持客户端方法：${message.method}`,
      },
    });
  }
}

export interface AttachmentPayload {
  name: string;
  storedPath: string;
  absolutePath: string;
  mime: string;
  kind: string;
  text?: string;
  dataUrl?: string;
}

export function buildPromptParts(
  text: string,
  attachments: AttachmentPayload[],
  imageSupported: boolean,
): PromptPart[] {
  const imageFiles = attachments.filter(
    (file) => imageSupported && file.kind === "image" && file.dataUrl?.includes(","),
  );
  const otherFiles = attachments.filter(
    (file) => !(imageSupported && file.kind === "image" && file.dataUrl?.includes(",")),
  );
  const body = [text.trim()].filter(Boolean);
  if (otherFiles.length) {
    body.push("", "我附加了这些文件，请查看：");
    for (const file of otherFiles) {
      body.push(`- ${file.storedPath}（${file.name}）`);
    }
  }
  const parts: PromptPart[] = [
    { type: "text", text: body.join("\n") || (imageFiles.length ? "请查看图片" : "请查看我附加的文件") },
  ];
  for (const file of imageFiles) {
    parts.push({
      type: "image",
      mimeType: file.mime,
      data: file.dataUrl!.slice(file.dataUrl!.indexOf(",") + 1),
    });
  }
  for (const file of otherFiles) {
    if (file.kind === "text" && file.text) {
      parts.push({
        type: "resource",
        resource: {
          uri: pathToFileUri(file.absolutePath),
          mimeType: file.mime,
          text: file.text,
        },
      });
    }
  }
  return parts;
}

function pathToFileUri(path: string): string {
  const normalized = path.replace(/\\/g, "/");
  return normalized.startsWith("/")
    ? `file://${normalized}`
    : `file:///${normalized}`;
}
