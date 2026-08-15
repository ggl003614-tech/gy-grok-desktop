import { useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  Boxes,
  Bot,
  CheckCircle2,
  Database,
  GitFork,
  HardDrive,
  History,
  Info,
  LoaderCircle,
  Network,
  RefreshCw,
  Search,
  TerminalSquare,
  Users,
  X,
} from "lucide-react";
import { useT } from "./i18n";

type ProbeKind =
  | "version"
  | "models"
  | "inspect"
  | "sessions"
  | "sessionSearch"
  | "mcp"
  | "plugins"
  | "worktrees"
  | "leaders"
  | "update"
  | "diskUsage";

interface CliCommandOutput {
  kind: string;
  args: string[];
  success: boolean;
  exitCode?: number;
  stdout: string;
  stderr: string;
  truncated: boolean;
}

const PROBES: Array<{
  kind: ProbeKind;
  label: string;
  description: string;
  icon: typeof Bot;
}> = [
  { kind: "models", label: "模型", description: "可用模型与默认配置", icon: Bot },
  { kind: "sessions", label: "会话", description: "最近 100 个 Grok 会话", icon: History },
  { kind: "mcp", label: "MCP", description: "已配置的工具服务器", icon: Network },
  { kind: "plugins", label: "插件", description: "Grok Build 插件清单", icon: Boxes },
  { kind: "worktrees", label: "Worktree", description: "并行 Git 工作区", icon: GitFork },
  { kind: "leaders", label: "Leader", description: "多智能体 Leader 状态", icon: Users },
  { kind: "update", label: "更新", description: "检查 Grok CLI 新版本", icon: RefreshCw },
  { kind: "diskUsage", label: "磁盘", description: "Grok 数据占用", icon: HardDrive },
  { kind: "inspect", label: "诊断", description: "当前配置与运行环境", icon: Info },
  { kind: "version", label: "版本", description: "Grok CLI 版本信息", icon: TerminalSquare },
];

function prettyOutput(output?: CliCommandOutput) {
  if (!output) return "";
  const value = output.stdout || output.stderr;
  try {
    return JSON.stringify(JSON.parse(value), null, 2);
  } catch {
    return value.trimEnd();
  }
}

export function CommandCenter({
  project,
  onError,
  onClose,
}: {
  project: string;
  onError: (message: string) => void;
  onClose?: () => void;
}) {
  const t = useT();
  const [selected, setSelected] = useState<ProbeKind>("models");
  const [output, setOutput] = useState<CliCommandOutput>();
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState("");
  const current = PROBES.find((probe) => probe.kind === selected) ?? PROBES[0];
  const display = useMemo(() => prettyOutput(output), [output]);

  const run = async (kind = selected) => {
    setSelected(kind);
    setLoading(true);
    setOutput(undefined);
    try {
      const result = await invoke<CliCommandOutput>("run_cli_probe", {
        request: {
          kind,
          cwd: project || undefined,
          query: kind === "sessionSearch" ? query : undefined,
        },
      });
      setOutput(result);
    } catch (error) {
      onError(String(error));
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className="command-page">
      <header className="page-toolbar">
        <div><span className="page-icon"><Database size={17} /></span><div><strong>Grok 管理</strong><small>常用 CLI 能力的图形界面</small></div></div>
        <div className="page-toolbar-actions">
          <div className="command-search">
            <Search size={13} />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索历史会话" onKeyDown={(event) => { if (event.key === "Enter" && query.trim()) void run("sessionSearch"); }} />
            <button disabled={!query.trim() || loading} onClick={() => void run("sessionSearch")}>搜索</button>
          </div>
          {onClose ? (
            <button type="button" className="page-close" onClick={onClose}>
              <X size={14} /> {t("common.close")}
            </button>
          ) : null}
        </div>
      </header>
      <div className="command-layout">
        <aside className="command-grid">
          {PROBES.map(({ kind, label, description, icon: Icon }) => (
            <button key={kind} className={selected === kind ? "active" : ""} onClick={() => void run(kind)} disabled={loading}>
              <span><Icon size={15} /></span>
              <div><strong>{label}</strong><small>{description}</small></div>
            </button>
          ))}
        </aside>
        <div className="command-output">
          <div className="command-output-head">
            <div><strong>{current.label}</strong><span>{output ? `$ grok ${output.args.join(" ")}` : current.description}</span></div>
            {output && <span className={output.success ? "command-ok" : "command-fail"}>{output.success ? <CheckCircle2 size={13} /> : null}{output.success ? "完成" : `退出码 ${output.exitCode ?? "?"}`}</span>}
          </div>
          {loading ? (
            <div className="page-loading"><LoaderCircle className="spin" size={17} />正在运行只读 Grok 命令…</div>
          ) : output ? (
            <>
              {output.truncated && <div className="truncated-warning">输出超过 2 MB，当前只显示前半部分。</div>}
              <pre>{display || "命令执行成功，没有返回文本。"}</pre>
            </>
          ) : (
            <div className="empty-page compact"><Database size={20} /><h3>选择一项进行检查</h3><p>这些操作只读取 Grok CLI 状态，不修改配置。</p></div>
          )}
        </div>
      </div>
    </section>
  );
}
