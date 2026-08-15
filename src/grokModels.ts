import type { ConnectOptions, GrokModel } from "./acpClient";

export interface GrokModelsList {
  defaultModelId: string;
  modelIds: string[];
}

export interface AgentProcessStartOptions {
  cwd: string;
  alwaysApprove: boolean;
  permissionMode?: string;
  leader?: boolean;
  debug: boolean;
}

export function parseGrokModelsList(text: string): GrokModelsList {
  const cleaned = text.replace(/^\uFEFF/, "").replace(/\r/g, "");
  const defaultMatch = cleaned.match(/^\s*Default model:\s+(\S+)/im);
  const defaultModelId = stripModelPunctuation(defaultMatch?.[1] ?? "");
  const modelIds: string[] = [];
  const seen = new Set<string>();
  const add = (raw: string) => {
    const id = stripModelPunctuation(raw);
    if (!id || seen.has(id)) return;
    seen.add(id);
    modelIds.push(id);
  };
  if (defaultModelId) add(defaultModelId);
  for (const line of cleaned.split("\n")) {
    const bullet = line.match(/^\s*[*+\-•]\s+(\S+)/);
    if (bullet) add(bullet[1]);
  }
  return { defaultModelId, modelIds };
}

export function grokModelDisplayName(modelId: string) {
  const trimmed = modelId.trim();
  if (!trimmed) return "Grok";
  return trimmed.replace(/^grok-/i, "Grok ").replace(/-/g, " ");
}

export function agentProcessStartOptions(
  cwd: string,
  options: Pick<ConnectOptions, "alwaysApprove" | "permissionMode" | "leader" | "debug"> = {},
): AgentProcessStartOptions {
  const start: AgentProcessStartOptions = {
    cwd,
    alwaysApprove: options.alwaysApprove ?? false,
    debug: options.debug ?? false,
  };
  if (options.permissionMode) start.permissionMode = options.permissionMode;
  if (options.leader) start.leader = options.leader;
  return start;
}

export function resolvePreferredSessionModel(
  requested: string | undefined,
  availableIds: readonly string[],
  currentId: string,
) {
  const id = requested?.trim();
  if (!id || !availableIds.includes(id)) return undefined;
  return id || currentId;
}

export function mergeModelCatalog(
  advertised: GrokModel[],
  cliModelIds: readonly string[],
): GrokModel[] {
  const byId = new Map<string, GrokModel>();
  for (const model of advertised) {
    if (model.modelId) byId.set(model.modelId, model);
  }
  for (const id of cliModelIds) {
    if (!id || byId.has(id)) continue;
    byId.set(id, {
      modelId: id,
      name: grokModelDisplayName(id),
      supportsReasoningEffort: false,
      reasoningEfforts: [],
    });
  }
  const order: string[] = [];
  const seen = new Set<string>();
  for (const id of [...cliModelIds, ...advertised.map((model) => model.modelId)]) {
    if (!id || seen.has(id) || !byId.has(id)) continue;
    seen.add(id);
    order.push(id);
  }
  return order.map((id) => byId.get(id)).filter((model): model is GrokModel => Boolean(model));
}

function stripModelPunctuation(value: string) {
  return value.trim().replace(/[.,;)]+$/, "");
}
