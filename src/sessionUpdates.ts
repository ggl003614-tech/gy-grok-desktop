import type { JsonObject } from "./acpClient";

export type TimelineKind =
  | "user"
  | "assistant"
  | "thought"
  | "tool"
  | "status"
  | "error";

export interface TimelineImage {
  src: string;
  alt?: string;
}

export interface TimelineItem {
  id: string;
  kind: TimelineKind;
  text: string;
  title?: string;
  status?: string;
  toolCallId?: string;
  images?: TimelineImage[];
  source?: "local" | "remote";
  /** goal 驱动器注入的内部指令（Summarizer / Plan Writer / 验证器提示词）。
   *  它们走 user_message_chunk 混进来，界面上会冒充「你」说的话，要折叠。 */
  harness?: boolean;
  raw?: JsonObject;
}

export interface UsageInfo {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  contextUsed?: number;
  contextSize?: number;
  costAmount?: number;
  costCurrency?: string;
}

export interface ParsedUpdate {
  kind: "append" | "chunk" | "tool" | "usage" | "ignore";
  item?: TimelineItem;
  usage?: UsageInfo;
}

function textFromContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (content && typeof content === "object") {
    const value = content as JsonObject;
    if (typeof value.text === "string") return value.text;
    if (value.type === "resource_link") {
      const label = String(value.name ?? value.title ?? value.uri ?? "Resource");
      return typeof value.uri === "string" ? `[${label}](${value.uri})` : label;
    }
    if (value.type === "resource") {
      const resource = (value.resource ?? {}) as JsonObject;
      if (typeof resource.text === "string") return resource.text;
      return `资源：${String(resource.uri ?? "未命名")}`;
    }
    if (value.type === "image") {
      return "";
    }
    if (value.type === "audio") {
      return `音频输出（${String(value.mimeType ?? "未知格式")}）`;
    }
  }
  return "";
}

const SECRET_KEY = /token|secret|password|passwd|authorization|cookie|api[_-]?key|credential/i;

export function redactForDisplay(value: unknown, depth = 0): unknown {
  if (depth > 8) return "[内容过深]";
  if (Array.isArray(value)) {
    return value.slice(0, 100).map((entry) => redactForDisplay(entry, depth + 1));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as JsonObject)
        .slice(0, 100)
        .map(([key, entry]) => [
          key,
          SECRET_KEY.test(key) ? "[已隐藏]" : redactForDisplay(entry, depth + 1),
        ]),
    );
  }
  if (typeof value === "string") {
    return value
      .replace(/(bearer\s+)[a-z0-9._~+/-]+/gi, "$1[已隐藏]")
      .replace(/([?&](?:token|key|secret|signature)=)[^&\s]+/gi, "$1[已隐藏]")
      .slice(0, 100_000);
  }
  return value;
}

export function safeDisplayJson(value: unknown): string {
  return JSON.stringify(redactForDisplay(value), null, 2);
}

const TOOL_LABELS: Array<[RegExp, string]> = [
  [/search_replace|edit_file|str_replace|apply_patch/i, "编辑"],
  [/read_file|read\b/i, "读取"],
  [/write|create_file/i, "写入"],
  [/grep|rg\b|search/i, "搜索"],
  [/list_dir|glob|list_dir/i, "浏览"],
  [/run_terminal|bash|shell|command/i, "命令"],
  [/web_search|web_fetch/i, "联网"],
  [/image_gen|imagine/i, "生图"],
  [/image_edit/i, "改图"],
  [/todo/i, "任务"],
];

export function friendlyToolName(title: string): string {
  for (const [pattern, label] of TOOL_LABELS) {
    if (pattern.test(title)) return label;
  }
  return title.replace(/^tool[_-\s]*/i, "").trim() || "工具";
}

function firstString(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function shortPath(path: string): string {
  const normalized = path.replace(/\\/g, "/");
  const parts = normalized.split("/").filter(Boolean);
  return parts.slice(-2).join("/") || normalized;
}

export function toolSummary(update: JsonObject): string {
  const toolCall = (update.toolCall ?? update) as JsonObject;
  const input = (toolCall.rawInput ?? update.rawInput ?? {}) as JsonObject;
  const path = firstString(input.path, input.file, input.target, input.uri);
  if (path) return shortPath(path);

  const command = firstString(input.command, input.cmd, input.script);
  if (command) {
    const line = command.split(/\r?\n/)[0]?.trim() ?? "";
    return line.length > 72 ? `${line.slice(0, 72)}…` : line;
  }

  const query = firstString(input.query, input.pattern, input.glob);
  if (query) return query.length > 72 ? `${query.slice(0, 72)}…` : query;

  if (Array.isArray(update.locations) && update.locations.length) {
    const location = (update.locations[0] ?? {}) as JsonObject;
    if (typeof location.path === "string") return shortPath(location.path);
  }

  if (Array.isArray(update.content)) {
    for (const entry of update.content) {
      const item = (entry ?? {}) as JsonObject;
      if (item.type === "diff" && typeof item.path === "string") {
        return shortPath(item.path);
      }
      if (item.type === "content") {
        const text = textFromContent(item.content).trim();
        if (text) {
          const line = text.split(/\r?\n/)[0] ?? "";
          return line.length > 72 ? `${line.slice(0, 72)}…` : line;
        }
      }
    }
  }
  return "";
}

function toolTitle(update: JsonObject): string {
  const raw = String(
    update.title ??
      (update.toolCall as JsonObject | undefined)?.title ??
      update.kind ??
      "工具",
  );
  return friendlyToolName(raw);
}

function planText(entries: unknown): string {
  if (!Array.isArray(entries)) return "计划已更新";
  return entries
    .map((entry) => {
      const item = (entry ?? {}) as JsonObject;
      const status = String(item.status ?? "pending");
      const marker = status === "completed" ? "[x]" : status === "in_progress" ? "[~]" : "[ ]";
      return `${marker} ${String(item.content ?? "未命名步骤")}`;
    })
    .join("\n");
}

export function guessImageMime(data: string, declared?: string) {
  const given = declared?.trim();
  if (given && given !== "image/png" && given !== "image/*") return given;
  const raw = data.startsWith("data:") ? data.slice(data.indexOf(",") + 1) : data;
  if (raw.startsWith("/9j/")) return "image/jpeg";
  if (raw.startsWith("iVBOR")) return "image/png";
  if (raw.startsWith("R0lGOD")) return "image/gif";
  if (raw.startsWith("UklGR")) return "image/webp";
  return given || "image/png";
}

export function mergeTimelineImages(
  current?: TimelineImage[],
  incoming?: TimelineImage[],
): TimelineImage[] | undefined {
  const seen = new Set<string>();
  const unique: TimelineImage[] = [];
  for (const image of [...(current ?? []), ...(incoming ?? [])]) {
    if (!image.src || seen.has(image.src)) continue;
    seen.add(image.src);
    unique.push(image);
  }
  return unique.length ? unique : undefined;
}

export function imagesFromContent(content: unknown): TimelineImage[] {
  const values = Array.isArray(content) ? content : content ? [content] : [];
  const images: TimelineImage[] = [];
  for (const entry of values) {
    if (!entry || typeof entry !== "object") continue;
    const value = entry as JsonObject;
    if (Array.isArray(value.images)) {
      images.push(...imagesFromContent(value.images));
    }
    const nested = value.type === "content" ? value.content : value;
    const image = (nested && typeof nested === "object" ? nested : value) as JsonObject;
    if (image.type !== "image" && value.type !== "image") continue;
    const data =
      typeof image.data === "string"
        ? image.data
        : typeof value.data === "string"
          ? value.data
          : "";
    const uri = firstString(image.uri, image.url, value.uri, value.url);
    if (data) {
      const mime = guessImageMime(data, String(image.mimeType ?? value.mimeType ?? ""));
      images.push({
        src: data.startsWith("data:") ? data : `data:${mime};base64,${data}`,
        alt: firstString(image.alt, image.name, value.alt, value.name) || undefined,
      });
    } else if (uri && /^(data:image\/|blob:|https?:\/\/|file:)/i.test(uri)) {
      images.push({
        src: uri,
        alt: firstString(image.alt, image.name, value.alt, value.name) || undefined,
      });
    }
  }
  return images;
}

export function imagesFromMarkdown(text: string): TimelineImage[] {
  const images: TimelineImage[] = [];
  const seen = new Set<string>();
  const add = (src: string, alt?: string) => {
    const value = src.trim();
    if (!value || seen.has(value)) return;
    if (!/\.(png|jpe?g|gif|webp|bmp|svg)(\?|#|$)/i.test(value) && !value.startsWith("data:image/")) {
      return;
    }
    seen.add(value);
    images.push({ src: value, alt });
  };
  for (const match of text.matchAll(/!\[([^\]]*)\]\(([^)\s]+)\)/g)) {
    add(match[2], match[1] || undefined);
  }
  for (const match of text.matchAll(/(?:^|[\s`'"])((?:images|img|png)\/[\w./-]+\.(?:png|jpe?g|gif|webp))/gi)) {
    add(match[1]);
  }
  return images;
}

function contentText(content: unknown): string {
  if (Array.isArray(content)) {
    return content.map((entry) => textFromContent(entry)).filter(Boolean).join("");
  }
  return textFromContent(content);
}

/**
 * 这条「用户消息」是不是 goal 驱动器的内部指令。
 *
 * goal 每轮会注入 Summarizer / Plan Writer / adversarial verifier 这类提示词，
 * 协议上它们跟真的用户输入没有任何区别（都是 user_message_chunk，没有 _meta 标记），
 * 只能按文案特征认。特征来自真实数据：本机数据库里被污染的会话标题、
 * 以及用户截图里的原文（"You are the Goal Summarizer for the xAI Grok Build harness"）。
 */
export function isHarnessPrompt(text: string): boolean {
  const head = text.trimStart().slice(0, 200);
  if (!head.startsWith("You are ")) return false;
  return (
    head.includes("Grok Build harness") ||
    /^You are (?:the|an?) .{0,80}(?:Summarizer|Plan Writer|[Vv]erifier)/.test(head)
  );
}

export function parseSessionUpdate(update: JsonObject): ParsedUpdate {
  const type = String(update.sessionUpdate ?? "");
  const id = crypto.randomUUID();

  if (type === "user_message_chunk") {
    const userText = contentText(update.content);
    return {
      kind: "chunk",
      item: {
        id,
        kind: "user",
        harness: isHarnessPrompt(userText) || undefined,
        text: userText,
        images: mergeTimelineImages(
          imagesFromContent(update.content),
          imagesFromMarkdown(userText),
        ),
      },
    };
  }

  if (type === "agent_message_chunk") {
    const text = contentText(update.content);
    return {
      kind: "chunk",
      item: {
        id,
        kind: "assistant",
        text,
        images: mergeTimelineImages(imagesFromContent(update.content), imagesFromMarkdown(text)),
      },
    };
  }

  if (type === "agent_thought_chunk") {
    return {
      kind: "chunk",
      item: { id, kind: "thought", text: textFromContent(update.content) },
    };
  }

  if (type === "tool_call" || type === "tool_call_update") {
    const toolCall = (update.toolCall ?? update) as JsonObject;
    return {
      kind: "tool",
      item: {
        id,
        kind: "tool",
        title: toolTitle(update),
        text: toolSummary(toolCall) || toolSummary(update),
        status: String(update.status ?? toolCall.status ?? "pending"),
        toolCallId: String(update.toolCallId ?? toolCall.toolCallId ?? id),
        images: mergeTimelineImages(
          imagesFromContent(update.content),
          mergeTimelineImages(
            imagesFromContent(toolCall.content),
            imagesFromContent(update.images ?? toolCall.images),
          ),
        ),
        raw: update,
      },
    };
  }

  if (type === "turn_completed" || type === "response_completed" || type === "usage_update") {
    const usage = (update.usage ?? {}) as JsonObject;
    const cost = (update.cost ?? usage.cost ?? {}) as JsonObject;
    const inputTokens = Number(usage.inputTokens ?? usage.input_tokens) || undefined;
    const outputTokens = Number(usage.outputTokens ?? usage.output_tokens) || undefined;
    const reported = Number(usage.totalTokens ?? usage.total_tokens ?? update.used) || undefined;
    const contextSize = Number(update.size ?? usage.contextSize ?? usage.context_size) || undefined;
    const contextOnly = type === "usage_update" && inputTokens == null && outputTokens == null;
    return {
      kind: "usage",
      usage: {
        inputTokens,
        outputTokens,
        totalTokens: contextOnly ? undefined : reported,
        contextUsed: contextOnly ? reported : undefined,
        contextSize,
        costAmount: Number(cost.amount) || undefined,
        costCurrency:
          typeof cost.currency === "string" ? cost.currency : undefined,
      },
    };
  }

  if (type === "plan") {
    return {
      kind: "append",
      item: {
        id,
        kind: "status",
        title: "执行计划",
        text: planText(update.entries),
      },
    };
  }

  if (type === "plan_update") {
    const plan = (update.plan ?? {}) as JsonObject;
    return {
      kind: "append",
      item: {
        id,
        kind: "status",
        title: "执行计划已更新",
        text:
          plan.type === "markdown" && typeof plan.content === "string"
            ? plan.content
            : plan.type === "file"
              ? `计划文件：${String(plan.uri ?? "未知")}`
              : planText(plan.entries),
      },
    };
  }

  if (type === "plan_removed") {
    return {
      kind: "append",
      item: { id, kind: "status", title: "执行计划已结束", text: "" },
    };
  }

  if ([
    "available_commands_update",
    "current_mode_update",
    "config_option_update",
    "session_info_update",
    "last_turn_summary",
    "session_summary_generated",
  ].includes(type)) {
    return { kind: "ignore" };
  }

  return { kind: "ignore" };
}

export type TimelineRow =
  | { id: string; type: "item"; item: TimelineItem }
  | { id: string; type: "tools"; items: TimelineItem[] };

export function groupTimeline(items: TimelineItem[]): TimelineRow[] {
  const rows: TimelineRow[] = [];
  let index = 0;
  while (index < items.length) {
    const current = items[index];
    if (current.kind === "tool") {
      const batch: TimelineItem[] = [];
      while (index < items.length && items[index].kind === "tool") {
        batch.push(items[index]);
        index += 1;
      }
      rows.push({
        id: `tools-${batch[0].toolCallId ?? batch[0].id}`,
        type: "tools",
        items: batch,
      });
      continue;
    }
    rows.push({ id: current.id, type: "item", item: current });
    index += 1;
  }
  return rows;
}

const LOCAL_PREVIEW_URL =
  /https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?(?:\/[^\s)\]>'"]*)?/gi;

export function extractLocalPreviewUrls(text: string): string[] {
  const matches = text.match(LOCAL_PREVIEW_URL) ?? [];
  return [...new Set(matches.map((url) => url.replace(/[.,;]+$/, "")))];
}

export function isInlineImageSrc(src: string) {
  return /^(data:image\/|blob:|https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\]|asset\.localhost)|asset:)/i.test(
    src,
  );
}

export function localImageAbsolutePath(src: string, project?: string) {
  const cleaned = src
    .trim()
    .replace(/^file:\/\//i, "")
    .replace(/^\/([A-Za-z]:)/, "$1");
  if (/^[A-Za-z]:[\\/]/.test(cleaned) || cleaned.startsWith("\\\\")) return cleaned;
  const relative = cleaned.replace(/\\/g, "/").replace(/^\.\//, "");
  if (project && /^(images|img|png)\//i.test(relative)) {
    return `${project.replace(/[\\/]+$/, "")}\\${relative.replace(/\//g, "\\")}`;
  }
  return undefined;
}

export function isSafePreviewUrl(url: string): boolean {
  const value = url.trim();
  return (
    /^(https?:\/\/)(localhost|127\.0\.0\.1|\[::1\])(:\d+)?(\/.*)?$/i.test(value) &&
    !/[\s'"<>\\]/.test(value) &&
    value.length < 512
  );
}

/** 流式过程中会交替出现的两种块。往回找合并目标时可以跨过对方，
 *  但不能跨过用户消息、工具调用这些有结构意义的项。 */
const STREAMING_KINDS = new Set(["assistant", "thought"]);

function lastStreamingIndex(items: TimelineItem[], kind: string) {
  for (let i = items.length - 1; i >= 0; i--) {
    const candidate = items[i];
    if (candidate.kind === kind) return i;
    if (!STREAMING_KINDS.has(candidate.kind)) return -1;
  }
  return -1;
}

export function applyParsedUpdate(
  items: TimelineItem[],
  parsed: ParsedUpdate,
): TimelineItem[] {
  if (!parsed.item) return items;
  const item = parsed.item;

  if (parsed.kind === "chunk") {
    const last = items.at(-1);
    if (item.kind === "user" && last?.kind === "user" && last.source === "local") {
      return [...items.slice(0, -1), {
        ...last,
        images: last.images?.length ? last.images : item.images,
      }];
    }
    // Grok 是「正文→推理→正文→推理」交替流出来的。只看最后一条的话，
    // 每交替一次正文就断成新的一条，一段回答会碎成十几个气泡。
    // 所以往回找同类时跳过另一种流式项，正文归正文、推理归推理。
    const index = lastStreamingIndex(items, item.kind);
    if (index >= 0) {
      const previous = items[index];
      const next = [...items];
      next[index] = {
        ...previous,
        text: previous.text + item.text,
        images: [...(previous.images ?? []), ...(item.images ?? [])],
      };
      return next;
    }
    return [...items, item];
  }

  if (parsed.kind === "tool" && item.toolCallId) {
    const index = items.findIndex(
      (candidate) => candidate.toolCallId === item.toolCallId,
    );
    if (index >= 0) {
      const next = [...items];
      const previous = next[index];
      next[index] = {
        ...previous,
        ...item,
        title: item.title === "正在使用工具" ? previous.title : item.title,
        text: item.text || previous.text,
        images: mergeTimelineImages(previous.images, item.images),
        raw: { ...(previous.raw ?? {}), ...(item.raw ?? {}) },
      };
      return next;
    }
  }

  return [...items, item];
}
