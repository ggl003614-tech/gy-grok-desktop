import type { TimelineItem } from "./sessionUpdates";
import { hasVisibleConversationTurns } from "./grokHistory";

export function shouldShowConversationList(items: TimelineItem[]): boolean {
  return hasVisibleConversationTurns(items);
}

export function conversationEmptyKind(input: {
  restoring?: boolean;
  connecting?: boolean;
  connected?: boolean;
  project?: string;
  draft?: boolean;
  pendingTrust?: string;
}): "trust" | "connecting" | "restoring" | "pick-folder" | "ready" {
  if (input.pendingTrust) return "trust";
  if (input.restoring) return "restoring";
  if (input.connecting) return "connecting";
  if (input.draft || !input.connected || !input.project) return "pick-folder";
  return "ready";
}
