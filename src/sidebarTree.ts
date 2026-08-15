import { projectPathKey, sameProjectPath } from "./sessionMemory";

export const OTHER_FOLDER_KEY = "__other__";
export const OTHER_FOLDER_NAME = "其他";
const MAX_THREADS_PER_FOLDER = 40;

export interface SidebarSession {
  sessionId: string;
  cwd?: string;
  title?: string;
  summary?: string;
  updatedAt?: string;
  numChatMessages?: number;
  hasUserQuery?: boolean;
}

export interface SidebarFolder {
  key: string;
  path: string;
  name: string;
  other?: boolean;
  sessions: SidebarSession[];
}

export function folderDisplayName(path: string) {
  if (!path) return OTHER_FOLDER_NAME;
  const parts = path.replaceAll("\\", "/").split("/").filter(Boolean);
  return parts.at(-1) || path;
}

export function looksLikeCodeTitle(title: string) {
  const value = title.trim();
  return /^线程\s+[0-9a-f-]{6,}$/i.test(value)
    || /^[0-9a-f]{8}-[0-9a-f-]{19,}$/i.test(value);
}

export function sessionTitle(session: SidebarSession) {
  const title = session.title?.trim() || session.summary?.trim();
  if (title && !looksLikeCodeTitle(title)) return title;
  return "未命名对话";
}

export function isLooseFolderPath(path?: string) {
  const key = projectPathKey(path);
  if (!key) return true;
  if (/^[a-z]:$/.test(key)) return true;
  if (/(^|\\)(temp|tmp)$/i.test(key)) return true;
  return /appdata\\local\\temp/i.test(key);
}

function isPlaceholderTitle(title: string) {
  return /^(new task|recovered task|新对话|新线程)$/i.test(title)
    || /^线程 [0-9a-f]{8}$/i.test(title);
}

export function isJunkSession(session: SidebarSession) {
  const title = (session.title || session.summary || "").trim();
  const named = Boolean(title) && !isPlaceholderTitle(title);
  const messages = session.numChatMessages ?? 0;
  if (session.hasUserQuery === false && !named) return true;
  if (!named && messages <= 2) return true;
  return false;
}

function newerSession(left: SidebarSession, right: SidebarSession) {
  const leftTime = left.updatedAt ? Date.parse(left.updatedAt) : 0;
  const rightTime = right.updatedAt ? Date.parse(right.updatedAt) : 0;
  return (Number.isFinite(rightTime) ? rightTime : 0) - (Number.isFinite(leftTime) ? leftTime : 0);
}

export function dedupeSessions(sessions: SidebarSession[]) {
  const map = new Map<string, SidebarSession>();
  for (const session of sessions) {
    if (!session.sessionId) continue;
    const existing = map.get(session.sessionId);
    if (!existing || newerSession(existing, session) > 0) {
      map.set(session.sessionId, session);
    }
  }
  return [...map.values()];
}

function stableSessionOrder(left: SidebarSession, right: SidebarSession) {
  return right.sessionId.localeCompare(left.sessionId) || left.sessionId.localeCompare(right.sessionId);
}

export function groupSessionsByFolder(
  sessions: SidebarSession[],
  knownFolders: string[] = [],
  currentPath?: string,
): SidebarFolder[] {
  const cleaned = dedupeSessions(sessions).filter((item) => !isJunkSession(item));
  const known = [
    ...knownFolders,
    currentPath ?? "",
    ...cleaned.map((session) => session.cwd ?? ""),
  ]
    .map((path) => path.trim())
    .filter((path) => path && !isLooseFolderPath(path));
  const uniqueKnown: string[] = [];
  for (const path of known) {
    if (!uniqueKnown.some((entry) => sameProjectPath(entry, path))) {
      uniqueKnown.push(path);
    }
  }

  const folders = new Map<string, SidebarFolder>();
  const ensure = (path: string) => {
    const key = projectPathKey(path);
    const existing = folders.get(key);
    if (existing) return existing;
    const folder: SidebarFolder = {
      key,
      path,
      name: folderDisplayName(path),
      sessions: [],
    };
    folders.set(key, folder);
    return folder;
  };

  for (const path of uniqueKnown) ensure(path);

  const other: SidebarFolder = {
    key: OTHER_FOLDER_KEY,
    path: "",
    name: OTHER_FOLDER_NAME,
    other: true,
    sessions: [],
  };

  for (const session of cleaned) {
    const match = uniqueKnown.find((path) => sameProjectPath(path, session.cwd));
    if (match) ensure(match).sessions.push(session);
    else other.sessions.push(session);
  }

  for (const folder of folders.values()) {
    folder.sessions = folder.sessions
      .slice()
      .sort(stableSessionOrder)
      .slice(0, MAX_THREADS_PER_FOLDER);
  }
  other.sessions = other.sessions
    .slice()
    .sort(stableSessionOrder)
    .slice(0, MAX_THREADS_PER_FOLDER);

  const result = [...folders.values()].sort((left, right) =>
    left.name.localeCompare(right.name, "zh") || left.path.localeCompare(right.path, "zh"),
  );
  if (other.sessions.length) result.push(other);
  return result;
}

export function filterFolderTree(folders: SidebarFolder[], query: string): SidebarFolder[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return folders;
  return folders.flatMap((folder) => {
    const folderHit = `${folder.name} ${folder.path}`.toLowerCase().includes(needle);
    const sessions = folder.sessions.filter((session) =>
      `${sessionTitle(session)} ${session.sessionId}`.toLowerCase().includes(needle),
    );
    if (folderHit) return [folder];
    if (sessions.length) return [{ ...folder, sessions }];
    return [];
  });
}
