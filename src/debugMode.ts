export interface DebugEntryInput {
  source?: "log" | "notification" | "update";
  method?: string;
  payload?: unknown;
}

function compactJson(value: unknown): string {
  try {
    const text = JSON.stringify(value);
    return text.length > 400 ? `${text.slice(0, 400)}…` : text;
  } catch {
    return String(value);
  }
}

export function formatDebugEntry(input: DebugEntryInput | string): string {
  if (typeof input === "string") return input.trim();
  if (input.source === "log") {
    return String(input.payload ?? "").trim();
  }
  const method = input.method?.trim() ?? "";
  const payload = input.payload;
  if (payload && typeof payload === "object") {
    const value = payload as Record<string, unknown>;
    const nested = value.update && typeof value.update === "object"
      ? value.update as Record<string, unknown>
      : value;
    const kind = String(nested.sessionUpdate ?? value.sessionUpdate ?? "");
    const title = String(nested.title ?? value.title ?? "");
    const status = String(nested.status ?? "");
    const parts = [method, kind, title, status].filter((part) => part && part !== "undefined");
    const body = compactJson(nested);
    return `${parts.join(" ")} ${body}`.trim();
  }
  const text = String(payload ?? "").trim();
  return [method, text].filter(Boolean).join(" ").trim();
}
