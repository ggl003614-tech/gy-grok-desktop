import { useCallback, useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Virtuoso } from "react-virtuoso";
import {
  AlertCircle,
  ChevronRight,
  File,
  FileCode2,
  Folder,
  FolderOpen,
  LoaderCircle,
  RefreshCw,
  Search,
  X,
} from "lucide-react";
import { useT } from "./i18n";

interface FileEntry {
  path: string;
  name: string;
  isDirectory: boolean;
  isSymlink: boolean;
  size: number;
  modifiedAt?: number;
}

interface FileContent {
  path: string;
  content: string;
  size: number;
  lineCount: number;
  truncated: boolean;
}

function parentPath(path: string) {
  const parts = path.split("/").filter(Boolean);
  parts.pop();
  return parts.join("/");
}

function formatSize(size: number) {
  if (size < 1_024) return `${size} B`;
  if (size < 1_048_576) return `${(size / 1_024).toFixed(1)} KB`;
  return `${(size / 1_048_576).toFixed(1)} MB`;
}

export function FilesPanel({
  project,
  onError,
  onClose,
}: {
  project: string;
  onError: (message: string) => void;
  onClose?: () => void;
}) {
  const t = useT();
  const [directory, setDirectory] = useState("");
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [selected, setSelected] = useState("");
  const [content, setContent] = useState<FileContent>();
  const [loading, setLoading] = useState(false);
  const [fileLoading, setFileLoading] = useState(false);
  const [query, setQuery] = useState("");
  const [searchActive, setSearchActive] = useState(false);

  const loadDirectory = useCallback(async (relative: string) => {
    if (!project) return;
    setLoading(true);
    try {
      const result = await invoke<FileEntry[]>("list_workspace_directory", {
        root: project,
        relative,
      });
      setDirectory(relative);
      setEntries(result);
    } catch (error) {
      onError(String(error));
    } finally {
      setLoading(false);
    }
  }, [onError, project]);

  useEffect(() => {
    setDirectory("");
    setSelected("");
    setContent(undefined);
    void loadDirectory("");
  }, [loadDirectory, project]);

  const openEntry = async (entry: FileEntry) => {
    if (entry.isDirectory) {
      setQuery("");
      setSearchActive(false);
      await loadDirectory(entry.path);
      return;
    }
    setSelected(entry.path);
    setFileLoading(true);
    try {
      setContent(await invoke<FileContent>("read_workspace_file", {
        root: project,
        relative: entry.path,
      }));
    } catch (error) {
      setContent(undefined);
      onError(String(error));
    } finally {
      setFileLoading(false);
    }
  };

  const breadcrumbs = useMemo(
    () => directory.split("/").filter(Boolean),
    [directory],
  );
  const lines = useMemo(() => content?.content.split("\n") ?? [], [content?.content]);

  const search = async () => {
    const value = query.trim();
    if (!value) {
      setSearchActive(false);
      await loadDirectory(directory);
      return;
    }
    setLoading(true);
    try {
      setEntries(
        await invoke<FileEntry[]>("search_workspace_files", {
          root: project,
          query: value,
        }),
      );
      setSearchActive(true);
    } catch (error) {
      onError(String(error));
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className="files-page">
      <header className="page-toolbar">
        <div><span className="page-icon"><FolderOpen size={17} /></span><div><strong>项目文件</strong><small>受工作区边界保护的只读预览</small></div></div>
        <div className="file-toolbar-actions">
          <div className="file-search"><Search size={13} /><input value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void search(); }} placeholder="搜索文件路径" aria-label="搜索项目文件" />{query && <button aria-label="清除搜索" onClick={() => { setQuery(""); setSearchActive(false); void loadDirectory(directory); }}><X size={12} /></button>}</div>
          <button className="secondary-action compact" onClick={() => searchActive ? void search() : void loadDirectory(directory)} disabled={loading || !project}>
            <RefreshCw className={loading ? "spin" : ""} size={14} />刷新
          </button>
          {onClose ? (
            <button type="button" className="page-close" onClick={onClose}>
              <X size={14} /> {t("common.close")}
            </button>
          ) : null}
        </div>
      </header>
      {!project ? (
        <div className="empty-page"><Folder size={22} /><h3>请先打开项目</h3><p>文件只会从所选工作区中读取。</p></div>
      ) : (
        <div className="files-layout">
          <aside className="file-browser">
            <div className="file-breadcrumbs">
              {searchActive ? <span><Search size={11} /> 搜索“{query.trim()}”</span> : <><button onClick={() => void loadDirectory("")}>项目</button>{breadcrumbs.map((part, index) => (
                <span key={`${part}-${index}`}><ChevronRight size={11} /><button onClick={() => void loadDirectory(breadcrumbs.slice(0, index + 1).join("/"))}>{part}</button></span>
              ))}</>}
            </div>
            <div className="file-list">
              {directory && !searchActive && <button className="parent-folder" onClick={() => void loadDirectory(parentPath(directory))}><Folder size={14} /><span>..</span></button>}
              {entries.map((entry) => (
                <button key={entry.path} className={selected === entry.path ? "active" : ""} onClick={() => void openEntry(entry)} title={entry.path}>
                  {entry.isDirectory ? <Folder size={14} /> : <File size={14} />}
                  <span>{searchActive ? entry.path : entry.name}</span>
                  {!entry.isDirectory && <small>{formatSize(entry.size)}</small>}
                </button>
              ))}
              {loading && <div className="inline-loading"><LoaderCircle className="spin" size={14} />读取目录…</div>}
            </div>
          </aside>
          <div className="file-preview">
            {fileLoading ? (
              <div className="page-loading"><LoaderCircle className="spin" size={17} />读取文件…</div>
            ) : content ? (
              <>
                <div className="file-preview-head"><div><FileCode2 size={14} /><strong>{content.path}</strong></div><span>{formatSize(content.size)} · {content.lineCount} 行</span></div>
                {content.truncated && <div className="truncated-warning">文件超过 2 MB，当前只显示前半部分。</div>}
                <Virtuoso
                  className="code-lines"
                  totalCount={lines.length}
                  itemContent={(index) => <div className="code-line"><span>{index + 1}</span><code>{lines[index] || " "}</code></div>}
                />
              </>
            ) : (
              <div className="empty-page compact"><AlertCircle size={20} /><h3>选择一个文本文件</h3><p>二进制文件不会作为文本打开。</p></div>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
