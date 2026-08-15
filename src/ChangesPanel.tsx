import { useCallback, useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Virtuoso } from "react-virtuoso";
import {
  AlertCircle,
  FileDiff,
  GitBranch,
  LoaderCircle,
  RefreshCw,
  ScanSearch,
  X,
} from "lucide-react";
import { useT } from "./i18n";

interface GitChange {
  path: string;
  originalPath?: string;
  indexStatus: string;
  worktreeStatus: string;
}

interface GitStatus {
  isRepository: boolean;
  branch?: string;
  upstream?: string;
  ahead: number;
  behind: number;
  changes: GitChange[];
  error?: string;
}

interface GitDiff {
  path?: string;
  staged: boolean;
  content: string;
  truncated: boolean;
}

function statusLabel(change: GitChange) {
  if (change.indexStatus === "?" || change.worktreeStatus === "?") return "U";
  if (change.indexStatus === "A" || change.worktreeStatus === "A") return "A";
  if (change.indexStatus === "D" || change.worktreeStatus === "D") return "D";
  if (change.indexStatus === "R" || change.worktreeStatus === "R") return "R";
  return "M";
}

function lineKind(line: string) {
  if (line.startsWith("+++ ") || line.startsWith("--- ")) return "meta";
  if (line.startsWith("+")) return "added";
  if (line.startsWith("-")) return "removed";
  if (line.startsWith("@@")) return "hunk";
  if (line.startsWith("diff ") || line.startsWith("index ")) return "meta";
  return "context";
}

export function ChangesPanel({
  project,
  onError,
  onReview,
  reviewDisabled,
  onClose,
}: {
  project: string;
  onError: (message: string) => void;
  onReview?: () => void;
  reviewDisabled?: boolean;
  onClose?: () => void;
}) {
  const t = useT();
  const [status, setStatus] = useState<GitStatus>();
  const [selectedPath, setSelectedPath] = useState("");
  const [staged, setStaged] = useState(false);
  const [diff, setDiff] = useState<GitDiff>();
  const [loading, setLoading] = useState(false);
  const [diffLoading, setDiffLoading] = useState(false);

  const refresh = useCallback(async () => {
    if (!project) return;
    setLoading(true);
    try {
      const next = await invoke<GitStatus>("get_git_status", { root: project });
      setStatus(next);
      setSelectedPath((current) =>
        next.changes.some((change) => change.path === current)
          ? current
          : next.changes[0]?.path ?? "",
      );
    } catch (error) {
      onError(String(error));
    } finally {
      setLoading(false);
    }
  }, [onError, project]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const selected = status?.changes.find((change) => change.path === selectedPath);

  useEffect(() => {
    if (!selectedPath || !project) {
      setDiff(undefined);
      return;
    }
    let cancelled = false;
    setDiffLoading(true);
    void invoke<GitDiff>("get_git_diff", {
      root: project,
      path: selectedPath,
      staged,
    })
      .then((result) => {
        if (!cancelled) setDiff(result);
      })
      .catch((error) => {
        if (!cancelled) onError(String(error));
      })
      .finally(() => {
        if (!cancelled) setDiffLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [onError, project, selectedPath, staged]);

  useEffect(() => {
    if (!selected) return;
    const hasStaged = selected.indexStatus !== " " && selected.indexStatus !== "?";
    const hasUnstaged = selected.worktreeStatus !== " ";
    setStaged(hasStaged && !hasUnstaged);
  }, [selected]);

  const lines = useMemo(() => diff?.content.split("\n") ?? [], [diff?.content]);
  const stagedCount = status?.changes.filter(
    (change) => change.indexStatus !== " " && change.indexStatus !== "?",
  ).length ?? 0;
  const unstagedCount = status?.changes.filter(
    (change) => change.worktreeStatus !== " ",
  ).length ?? 0;

  return (
    <section className="changes-page">
      <header className="page-toolbar">
        <div>
          <span className="page-icon"><FileDiff size={17} /></span>
          <div><strong>更改审查</strong><small>{status?.branch ? `${status.branch}${status.upstream ? ` → ${status.upstream}` : ""}` : "Git diff"}</small></div>
        </div>
        <div className="page-toolbar-actions">
          {onReview ? (
            <button
              className="secondary-action compact"
              onClick={onReview}
              disabled={reviewDisabled || !project}
              title="用官方 /review 审查未提交改动"
            >
              <ScanSearch size={14} />让 Grok 审查
            </button>
          ) : null}
          <button className="secondary-action compact" onClick={() => void refresh()} disabled={loading || !project}>
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
        <div className="empty-page"><GitBranch size={22} /><h3>请先打开项目</h3><p>选择一个 Git 工作区后即可审查修改。</p></div>
      ) : status && !status.isRepository ? (
        <div className="empty-page"><AlertCircle size={22} /><h3>这不是 Git 仓库</h3><p>{status.error || "仍可在对话和 CLI 页面中使用 Grok。"}</p></div>
      ) : (
        <div className="changes-layout">
          <aside className="changes-sidebar">
            <div className="changes-summary">
              <span>{status?.changes.length ?? 0} 个文件</span>
              <small>{stagedCount} staged · {unstagedCount} unstaged</small>
            </div>
            <div className="change-files">
              {status?.changes.map((change) => (
                <button key={`${change.path}-${change.indexStatus}-${change.worktreeStatus}`} className={selectedPath === change.path ? "active" : ""} onClick={() => setSelectedPath(change.path)}>
                  <i className={`change-${statusLabel(change).toLowerCase()}`}>{statusLabel(change)}</i>
                  <span title={change.path}>{change.path}</span>
                </button>
              ))}
            </div>
          </aside>
          <div className="diff-pane">
            {selected ? (
              <>
                <div className="diff-toolbar">
                  <strong>{selected.path}</strong>
                  <div>
                    <button className={!staged ? "active" : ""} onClick={() => setStaged(false)}>工作区</button>
                    <button className={staged ? "active" : ""} onClick={() => setStaged(true)}>已暂存</button>
                  </div>
                </div>
                {diffLoading ? (
                  <div className="page-loading"><LoaderCircle className="spin" size={17} />正在生成 Diff…</div>
                ) : diff?.content ? (
                  <>
                    {diff.truncated && <div className="truncated-warning">Diff 超过 4 MB，当前只显示前半部分。</div>}
                    <Virtuoso
                      className="diff-lines"
                      totalCount={lines.length}
                      itemContent={(index) => {
                        const line = lines[index] ?? "";
                        return <div className={`diff-line ${lineKind(line)}`}><span>{index + 1}</span><code>{line || " "}</code></div>;
                      }}
                    />
                  </>
                ) : (
                  <div className="empty-page compact"><FileDiff size={20} /><h3>这个视图没有可显示的 Diff</h3><p>{selected.indexStatus === "?" ? "未跟踪文件尚未进入 Git Diff。" : "试试切换工作区/已暂存。"}</p></div>
                )}
              </>
            ) : (
              <div className="empty-page"><FileDiff size={22} /><h3>工作区是干净的</h3><p>Grok 修改文件后，差异会显示在这里。</p></div>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
