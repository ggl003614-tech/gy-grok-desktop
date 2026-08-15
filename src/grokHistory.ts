import type { JsonObject } from "./acpClient";
import { asTimelineItems } from "./sessionMemory";
import {
  applyParsedUpdate,
  imagesFromContent,
  mergeTimelineImages,
  parseSessionUpdate,
  type TimelineImage,
  type TimelineItem,
} from "./sessionUpdates";

function imagesFromHistoryEntry(value: JsonObject): TimelineImage[] | undefined {
  return mergeTimelineImages(
    imagesFromContent(value.images),
    imagesFromContent(value.content),
  );
}

export function hasVisibleConversationTurns(items: TimelineItem[]): boolean {
  return items.some((item) => {
    if (item.kind === "tool" || item.kind === "error") return true;
    if (item.images?.length) return true;
    return (item.kind === "user" || item.kind === "assistant") && Boolean(item.text.trim());
  });
}

function collectText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (!part || typeof part !== "object") return "";
        const value = part as JsonObject;
        return typeof value.text === "string" ? value.text : "";
      })
      .filter(Boolean)
      .join("\n");
  }
  if (content && typeof content === "object") {
    const value = content as JsonObject;
    if (typeof value.text === "string") return value.text;
  }
  return "";
}

function extractUserQuery(blob: string): string | undefined {
  const start = blob.indexOf("<user_query>");
  if (start >= 0) {
    const rest = blob.slice(start + "<user_query>".length);
    const end = rest.indexOf("</user_query>");
    if (end >= 0) {
      const query = rest.slice(0, end).trim();
      return query || undefined;
    }
  }
  if (/<(user_info|system-reminder|system_reminder|system-instruction)/i.test(blob)) {
    return undefined;
  }
  const trimmed = blob.trim();
  return trimmed || undefined;
}

function stripToolCalls(blob: string): string {
  let rest = blob;
  let out = "";
  while (true) {
    const start = rest.indexOf("<tool_call>");
    if (start < 0) {
      out += rest;
      break;
    }
    out += rest.slice(0, start);
    const close = rest.indexOf("</tool_call>", start);
    if (close < 0) break;
    rest = rest.slice(close + "</tool_call>".length);
  }
  return out.trim();
}

function pushItem(items: TimelineItem[], kind: TimelineItem["kind"], text: string, extra: Partial<TimelineItem> = {}) {
  const trimmed = text.trim();
  if (!trimmed && kind !== "tool" && !extra.images?.length) return;
  items.push({
    id: `grok-${kind}-${items.length + 1}`,
    kind,
    text: trimmed,
    ...extra,
  });
}

export function parseGrokChatHistory(text: string): TimelineItem[] {
  const items: TimelineItem[] = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    let value: JsonObject;
    try {
      value = JSON.parse(line) as JsonObject;
    } catch {
      continue;
    }
    const kind = String(value.type ?? value.role ?? "");
    const blob = collectText(value.content);
    if (kind === "user") {
      const query = extractUserQuery(blob);
      if (query) {
        pushItem(items, "user", query, { images: imagesFromHistoryEntry(value) });
      }
    } else if (kind === "assistant") {
      const clean = stripToolCalls(blob);
      if (clean || imagesFromHistoryEntry(value)?.length) {
        pushItem(items, "assistant", clean, { images: imagesFromHistoryEntry(value) });
      }
    } else if (kind === "reasoning" || kind === "thought") {
      if (blob.trim()) pushItem(items, "thought", blob);
    } else if (kind === "tool_result" || kind === "tool" || kind === "tool_use") {
      const title = String(value.title ?? value.name ?? "工具");
      pushItem(items, "tool", blob || title, {
        title,
        status: String(value.status ?? "completed"),
        toolCallId: String(value.toolCallId ?? value.id ?? `tool-${items.length + 1}`),
        images: imagesFromHistoryEntry(value),
      });
    }
  }
  return items;
}

function exportHeading(line: string): "user" | "assistant" | "tool" | "skip" | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith("## ")) return null;
  switch (trimmed.slice(3).trim().toLowerCase()) {
    case "user":
    case "你":
      return "user";
    case "assistant":
    case "grok":
      return "assistant";
    case "tools":
    case "tool":
    case "工具":
      return "tool";
    default:
      return null;
  }
}

export function parseGrokExport(markdown: string): TimelineItem[] {
  const items: TimelineItem[] = [];
  let current: { kind: "user" | "assistant" | "tool"; text: string } | undefined;
  const flush = () => {
    if (!current) return;
    const text = current.text.trim();
    if (!text) {
      current = undefined;
      return;
    }
    if (current.kind === "tool") {
      for (const line of text.split(/\r?\n/)) {
        const label = line.replace(/^[-*]\s*/, "").trim();
        if (label) {
          pushItem(items, "tool", label, {
            title: "工具",
            status: "completed",
            toolCallId: `export-tool-${items.length + 1}`,
          });
        }
      }
    } else {
      pushItem(items, current.kind, text);
    }
    current = undefined;
  };
  for (const line of markdown.split(/\r?\n/)) {
    const heading = exportHeading(line);
    if (heading) {
      flush();
      if (heading !== "skip") current = { kind: heading, text: "" };
      continue;
    }
    if (!current) continue;
    current.text = current.text ? `${current.text}\n${line}` : line;
  }
  flush();
  return items;
}

export function timelineFromAcpUpdates(updates: JsonObject[]): TimelineItem[] {
  return updates.reduce<TimelineItem[]>(
    (items, update) => applyParsedUpdate(items, parseSessionUpdate(update)),
    [],
  );
}

export function timelineFromUpdatesJsonl(text: string): TimelineItem[] {
  const updates: JsonObject[] = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    try {
      const value = JSON.parse(line) as JsonObject;
      const params = (value.params && typeof value.params === "object"
        ? value.params
        : value) as JsonObject;
      const update = (params.update && typeof params.update === "object"
        ? params.update
        : params) as JsonObject;
      if (update.sessionUpdate) updates.push(update);
    } catch {
      // skip malformed replay lines
    }
  }
  return timelineFromAcpUpdates(updates);
}

export function parseGrokTranscriptPayload(payload: unknown): TimelineItem[] {
  if (Array.isArray(payload)) return asTimelineItems(payload);
  if (!payload || typeof payload !== "object") return [];
  const value = payload as Record<string, unknown>;
  if (Array.isArray(value.items)) {
    const items = asTimelineItems(value.items);
    if (hasVisibleConversationTurns(items)) return items;
  }
  if (typeof value.markdown === "string") {
    const items = parseGrokExport(value.markdown);
    if (hasVisibleConversationTurns(items)) return items;
  }
  if (typeof value.jsonl === "string") {
    const items = parseGrokChatHistory(value.jsonl);
    if (hasVisibleConversationTurns(items)) return items;
  }
  if (typeof value.updates === "string") {
    return timelineFromUpdatesJsonl(value.updates);
  }
  return [];
}
