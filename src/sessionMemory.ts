import type { TimelineItem } from "./sessionUpdates";

export function projectPathKey(path?: string) {
  if (!path) return "";
  return path
    .replace(/^[\\/]{2}\?[\\/]/, "")
    .replaceAll("/", "\\")
    .replace(/[\\]+$/, "")
    .toLowerCase();
}

export function sameProjectPath(left?: string, right?: string) {
  if (!left || !right) return false;
  return projectPathKey(left) === projectPathKey(right);
}

export function transcriptLookup(
  previous: Array<{ id: string; remoteSessionId?: string }>,
  requestedRemoteId?: string,
  forceNew = false,
): { localId?: string; remoteId?: string; requireResume: boolean } {
  if (forceNew) return { requireResume: false };
  const remoteId = requestedRemoteId?.trim() || previous[0]?.remoteSessionId;
  if (!remoteId) return { requireResume: false };
  const localId = previous.find((entry) => entry.remoteSessionId === remoteId)?.id;
  return { localId, remoteId, requireResume: true };
}

export function lookupForConnect(
  previous: Array<{ id: string; remoteSessionId?: string }>,
  requestedRemoteId?: string,
  forceNew = false,
): { localId?: string; remoteId?: string; requireResume: boolean } {
  const explicit = requestedRemoteId?.trim();
  return transcriptLookup(previous, explicit, forceNew || !explicit);
}

export function serializeTimeline(items: TimelineItem[]): TimelineItem[] {
  return items.slice(-200).map((item) => ({
    id: item.id,
    kind: item.kind,
    text: item.text,
    title: item.title,
    status: item.status,
    toolCallId: item.toolCallId,
    images: item.images,
    source: item.source,
  }));
}

export function titleFromTranscript(items: TimelineItem[]) {
  const first = items.find((item) => item.kind === "user" && item.text.trim());
  const text = first?.text.trim() ?? "";
  if (!text) return "";
  return text.length > 48 ? `${text.slice(0, 48)}…` : text;
}

export function asTimelineItems(value: unknown): TimelineItem[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const item = entry as Partial<TimelineItem>;
    if (!item.kind || typeof item.text !== "string") return [];
    return [
      {
        id: String(item.id ?? crypto.randomUUID()),
        kind: item.kind,
        text: item.text,
        title: typeof item.title === "string" ? item.title : undefined,
        status: typeof item.status === "string" ? item.status : undefined,
        toolCallId: typeof item.toolCallId === "string" ? item.toolCallId : undefined,
        images: Array.isArray(item.images) ? item.images.filter((image) => image && typeof image.src === "string") : undefined,
        source: item.source === "local" || item.source === "remote" ? item.source : undefined,
      },
    ];
  });
}
