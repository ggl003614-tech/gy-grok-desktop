import { useState, type ReactNode } from "react";
import {
  ChevronDown,
  ChevronRight,
  Folder,
  MessageSquarePlus,
  PanelLeftClose,
  Pencil,
  Plus,
  Search,
} from "lucide-react";
import {
  OTHER_FOLDER_KEY,
  filterFolderTree,
  sessionTitle,
  type SidebarFolder,
} from "./sidebarTree";
import { sameProjectPath } from "./sessionMemory";
import type { RemoteSession } from "./acpClient";
import brandIcon from "./assets/grok-desk-icon.png";
import { useT } from "./i18n";

export function Sidebar({
  project,
  currentSessionId,
  folders,
  expanded,
  query,
  disabled,
  children,
  onQuery,
  onToggleFolder,
  onNewThread,
  onNewInFolder,
  onOpenThread,
  onRenameThread,
  onCollapse,
}: {
  project?: string;
  currentSessionId?: string;
  folders: SidebarFolder[];
  expanded: string[];
  query: string;
  disabled?: boolean;
  children?: ReactNode;
  onQuery: (value: string) => void;
  onToggleFolder: (key: string) => void;
  onNewThread: () => void;
  onNewInFolder: (path: string) => void;
  onOpenThread: (session: RemoteSession) => void;
  onRenameThread: (session: RemoteSession, title: string) => void;
  onCollapse: () => void;
}) {
  const t = useT();
  const visible = filterFolderTree(folders, query);
  const [editingId, setEditingId] = useState("");
  const [draftTitle, setDraftTitle] = useState("");

  return (
    <aside className="sidebar">
      <div className="title-drag" data-tauri-drag-region>
        <img className="brand-mark" src={brandIcon} alt="" />
        <span>GY Grok</span>
      </div>

      <div className="sidebar-head">
        <button
          className="new-session"
          onClick={onNewThread}
          disabled={disabled}
        >
          <MessageSquarePlus size={16} /> {t("sidebar.newThread")}
        </button>
        <button className="icon-button" onClick={onCollapse} title={t("sidebar.collapse")}>
          <PanelLeftClose size={17} />
        </button>
      </div>

      <label className="sidebar-search">
        <Search size={14} />
        <input
          value={query}
          onChange={(event) => onQuery(event.target.value)}
          placeholder={t("sidebar.search")}
          aria-label={t("sidebar.search")}
        />
      </label>

      <div className="sidebar-scroll">
        {visible.length === 0 ? (
          <div className="tree-empty">
            {query.trim() ? t("sidebar.noMatch") : t("sidebar.empty")}
          </div>
        ) : (
          <div className="folder-tree" role="tree">
            {visible.map((folder) => {
              const open = query.trim() !== "" || expanded.includes(folder.key);
              const current = sameProjectPath(folder.path, project);
              return (
                <div className={`tree-folder ${current ? "current" : ""}`} key={folder.key} role="treeitem" aria-expanded={open}>
                  <div className="tree-folder-row">
                    <button
                      className="tree-folder-main"
                      onClick={() => onToggleFolder(folder.key)}
                      title={folder.path}
                    >
                      {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                      <Folder size={14} />
                      <span>{folder.name}</span>
                      <em>{folder.sessions.length || ""}</em>
                    </button>
                    <button
                      className="tree-folder-add"
                      title={t("sidebar.newInFolder", { name: folder.name })}
                      onClick={() => onNewInFolder(folder.path)}
                      disabled={disabled || (!folder.path && folder.key !== OTHER_FOLDER_KEY)}
                    >
                      <Plus size={13} />
                    </button>
                  </div>
                  {open && (
                    <div className="tree-threads" role="group">
                      {folder.sessions.length === 0 ? (
                        <p className="tree-empty nested">{t("sidebar.folderEmpty")}</p>
                      ) : (
                        folder.sessions.map((session) => (
                          <div
                            key={session.sessionId}
                            className={`tree-thread ${session.sessionId === currentSessionId ? "active" : ""}`}
                          >
                            {editingId === session.sessionId ? (
                              <input
                                className="tree-rename"
                                value={draftTitle}
                                autoFocus
                                aria-label={t("sidebar.threadName")}
                                onChange={(event) => setDraftTitle(event.target.value)}
                                onClick={(event) => event.stopPropagation()}
                                onKeyDown={(event) => {
                                  if (event.key === "Enter") {
                                    event.preventDefault();
                                    onRenameThread(session, draftTitle);
                                    setEditingId("");
                                  }
                                  if (event.key === "Escape") setEditingId("");
                                }}
                                onBlur={() => {
                                  onRenameThread(session, draftTitle);
                                  setEditingId("");
                                }}
                              />
                            ) : (
                              <>
                                <button
                                  className="tree-thread-main"
                                  onClick={() => onOpenThread(session)}
                                  onDoubleClick={(event) => {
                                    event.preventDefault();
                                    setEditingId(session.sessionId);
                                    setDraftTitle(sessionTitle(session) === "未命名对话" ? "" : sessionTitle(session));
                                  }}
                                  title={`${sessionTitle(session)}（双击重命名）`}
                                >
                                  <span>{sessionTitle(session)}</span>
                                </button>
                                <button
                                  className="tree-rename-btn"
                                  title="重命名"
                                  aria-label={`重命名 ${sessionTitle(session)}`}
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    setEditingId(session.sessionId);
                                    setDraftTitle(sessionTitle(session) === "未命名对话" ? "" : sessionTitle(session));
                                  }}
                                >
                                  <Pencil size={12} />
                                </button>
                              </>
                            )}
                          </div>
                        ))
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

      </div>

      {children}
    </aside>
  );
}
