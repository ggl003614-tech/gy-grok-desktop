const STORAGE_KEY = "grok-desk-thread-names";

export function loadThreadNames(): Record<string, string> {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}") as Record<string, unknown>;
    return Object.fromEntries(
      Object.entries(raw).flatMap(([id, title]) =>
        typeof title === "string" && title.trim() ? [[id, title.trim()]] : [],
      ),
    );
  } catch {
    return {};
  }
}

export function saveThreadName(sessionId: string, title: string) {
  const names = loadThreadNames();
  const trimmed = title.trim();
  if (trimmed) names[sessionId] = trimmed;
  else delete names[sessionId];
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(names));
  } catch {
    // Storage can be unavailable in tests or locked-down webviews.
  }
  return names;
}

export function applyThreadNames<T extends { sessionId: string; title?: string }>(
  sessions: T[],
  names = loadThreadNames(),
): T[] {
  return sessions.map((session) => {
    const alias = names[session.sessionId];
    return alias ? { ...session, title: alias } : session;
  });
}
