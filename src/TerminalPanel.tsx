import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import {
  ChevronDown,
  CircleStop,
  Eraser,
  LoaderCircle,
  Play,
  RotateCcw,
  ShieldAlert,
  SlidersHorizontal,
  TerminalSquare,
  X,
} from "lucide-react";
import {
  ansiDangerRgb,
  ansiMutedRgb,
  resolvedDeskTheme,
  xtermTheme,
} from "./appearance";
import {
  buildAdvancedCliArgs,
  describeCliRisk,
  formatCliArgs,
  parseCliArgs,
  type AdvancedCliConfig,
} from "./cliArgs";
import { GROK_CLI_COVERAGE } from "./cliCoverage";
import { useT } from "./i18n";

interface TerminalInfo {
  terminalId: string;
  processId?: number;
  cwd: string;
  running: boolean;
}

interface TerminalOutputEvent {
  terminalId: string;
  data: number[];
}

interface TerminalExitEvent {
  terminalId: string;
  exitCode?: number;
  signal?: string;
  error?: string;
}

export function TerminalPanel({
  project,
  onError,
  onClose,
}: {
  project: string;
  onError: (message: string) => void;
  onClose?: () => void;
}) {
  const t = useT();
  const containerRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | undefined>(undefined);
  const fitRef = useRef<FitAddon | undefined>(undefined);
  const terminalIdRef = useRef("");
  const [command, setCommand] = useState("");
  const [running, setRunning] = useState(false);
  const [starting, setStarting] = useState(false);
  const [processId, setProcessId] = useState<number>();
  const [lastExit, setLastExit] = useState<string>();
  const [advanced, setAdvanced] = useState<AdvancedCliConfig>({
    sessionMode: "new",
    memory: "default",
    plan: "default",
    subagents: "default",
  });

  useEffect(() => {
    if (!containerRef.current) return;
    const terminal = new Terminal({
      allowProposedApi: false,
      convertEol: true,
      cursorBlink: true,
      cursorStyle: "bar",
      fontFamily: '"Cascadia Mono", "SFMono-Regular", Consolas, monospace',
      fontSize: 12,
      lineHeight: 1.18,
      scrollback: 10_000,
      theme: xtermTheme(resolvedDeskTheme()),
    });
    const fit = new FitAddon();
    terminal.loadAddon(fit);
    terminal.open(containerRef.current);
    fit.fit();
    const muted = ansiMutedRgb(resolvedDeskTheme());
    terminal.writeln(`\x1b[38;2;${muted}mGY Grok CLI\x1b[0m`);
    terminal.writeln("在上方输入 Grok 参数，留空则启动完整交互式 TUI。\r\n");
    terminalRef.current = terminal;
    fitRef.current = fit;
    const applyTheme = () => {
      terminal.options.theme = xtermTheme(resolvedDeskTheme());
    };
    const observer = new MutationObserver(applyTheme);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });

    const input = terminal.onData((data) => {
      const terminalId = terminalIdRef.current;
      if (terminalId) {
        void invoke("write_grok_terminal", { terminalId, data }).catch((error) =>
          onError(String(error)),
        );
      }
    });
    const resize = new ResizeObserver(() => {
      fit.fit();
      const terminalId = terminalIdRef.current;
      if (terminalId && terminal.rows && terminal.cols) {
        void invoke("resize_grok_terminal", {
          terminalId,
          rows: terminal.rows,
          columns: terminal.cols,
        }).catch(() => undefined);
      }
    });
    resize.observe(containerRef.current);

    return () => {
      observer.disconnect();
      resize.disconnect();
      input.dispose();
      terminal.dispose();
      terminalRef.current = undefined;
      fitRef.current = undefined;
    };
  }, [onError]);

  useEffect(() => {
    let outputUnlisten: UnlistenFn | undefined;
    let exitUnlisten: UnlistenFn | undefined;
    let disposed = false;
    void listen<TerminalOutputEvent>("grok-terminal-output", (event) => {
      if (event.payload.terminalId === terminalIdRef.current) {
        terminalRef.current?.write(new Uint8Array(event.payload.data));
      }
    }).then((unlisten) => {
      if (disposed) unlisten();
      else outputUnlisten = unlisten;
    });
    void listen<TerminalExitEvent>("grok-terminal-exit", (event) => {
      if (event.payload.terminalId !== terminalIdRef.current) return;
      setRunning(false);
      setProcessId(undefined);
      const detail = event.payload.error
        ? `错误：${event.payload.error}`
        : event.payload.signal
          ? `信号：${event.payload.signal}`
          : `退出码：${event.payload.exitCode ?? "未知"}`;
      setLastExit(detail);
      const muted = ansiMutedRgb(resolvedDeskTheme());
      terminalRef.current?.writeln(`\r\n\x1b[38;2;${muted}m[进程已结束 · ${detail}]\x1b[0m`);
      terminalIdRef.current = "";
    }).then((unlisten) => {
      if (disposed) unlisten();
      else exitUnlisten = unlisten;
    });
    return () => {
      disposed = true;
      outputUnlisten?.();
      exitUnlisten?.();
    };
  }, []);

  useEffect(
    () => () => {
      const terminalId = terminalIdRef.current;
      if (terminalId) void invoke("stop_grok_terminal", { terminalId });
    },
    [],
  );

  const stop = useCallback(async () => {
    const terminalId = terminalIdRef.current;
    if (!terminalId) return;
    try {
      await invoke("stop_grok_terminal", { terminalId });
      terminalIdRef.current = "";
      setRunning(false);
      setProcessId(undefined);
      terminalRef.current?.writeln(`\r\n\x1b[38;2;${ansiDangerRgb()}m[已停止]\x1b[0m`);
    } catch (error) {
      onError(String(error));
    }
  }, [onError]);

  const start = useCallback(async () => {
    if (!project) {
      onError("请先打开一个项目目录");
      return;
    }
    setStarting(true);
    setLastExit(undefined);
    try {
      if (terminalIdRef.current) await stop();
      const args = parseCliArgs(command);
      const risk = describeCliRisk(args);
      if (
        risk &&
        !window.confirm(
          `${risk}。\n\n即将运行：\n\ngrok ${formatCliArgs(args)}\n\n是否继续？`,
        )
      ) {
        return;
      }
      const terminal = terminalRef.current;
      const fit = fitRef.current;
      fit?.fit();
      terminal?.reset();
      const appearance = resolvedDeskTheme();
      terminal?.writeln(
        `\x1b[38;2;${ansiMutedRgb(appearance)}m$ grok${args.length ? ` ${args.join(" ")}` : ""}\x1b[0m`,
      );
      const info = await invoke<TerminalInfo>("start_grok_terminal", {
        options: {
          cwd: project,
          args,
          rows: terminal?.rows ?? 30,
          columns: terminal?.cols ?? 120,
          appearance,
        },
      });
      terminalIdRef.current = info.terminalId;
      setRunning(info.running);
      setProcessId(info.processId);
      terminal?.focus();
    } catch (error) {
      onError(String(error));
      terminalRef.current?.writeln(`\r\n\x1b[38;2;${ansiDangerRgb()}m${String(error)}\x1b[0m`);
    } finally {
      setStarting(false);
    }
  }, [command, onError, project, stop]);

  const setAdvancedValue = <Key extends keyof AdvancedCliConfig>(
    key: Key,
    value: AdvancedCliConfig[Key],
  ) => setAdvanced((current) => ({ ...current, [key]: value }));

  const applyAdvanced = () => {
    try {
      setCommand(formatCliArgs(buildAdvancedCliArgs(advanced)));
    } catch (error) {
      onError(String(error));
    }
  };

  return (
    <section className="terminal-page" aria-label="Grok CLI 终端">
      <header className="page-toolbar">
        <div>
          <span className="page-icon"><TerminalSquare size={17} /></span>
          <div><strong>Grok CLI</strong><small>完整 TUI 与全部子命令</small></div>
        </div>
        <div className="page-toolbar-actions">
          <div className="terminal-status">
            <i className={running ? "running" : ""} />
            <span>{running ? `运行中${processId ? ` · PID ${processId}` : ""}` : lastExit ?? "未运行"}</span>
          </div>
          {onClose ? (
            <button type="button" className="page-close" onClick={onClose}>
              <X size={14} /> {t("common.close")}
            </button>
          ) : null}
        </div>
      </header>
      <div className="terminal-commandbar">
        <span>grok</span>
        <input
          value={command}
          onChange={(event) => setCommand(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !running && !starting) void start();
          }}
          placeholder='留空启动 TUI，或输入：sessions list / models / login'
          aria-label="Grok CLI 参数"
          spellCheck={false}
        />
        {running ? (
          <button className="terminal-stop" onClick={() => void stop()}><CircleStop size={15} />停止</button>
        ) : (
          <button className="terminal-run" onClick={() => void start()} disabled={starting || !project}>
            {starting ? <LoaderCircle className="spin" size={15} /> : <Play size={15} />}
            运行
          </button>
        )}
        <button className="terminal-tool" onClick={() => terminalRef.current?.clear()} title="清屏"><Eraser size={15} /></button>
        <button className="terminal-tool" onClick={() => { setCommand(""); void stop(); }} title="重置"><RotateCcw size={15} /></button>
      </div>
      <div className="terminal-shortcuts">
        <button disabled={running} onClick={() => setCommand("")}>交互式 TUI</button>
        {GROK_CLI_COVERAGE.map((row) => (
          <button
            key={row.id}
            disabled={running}
            title={`${row.id} · ${row.surface}`}
            onClick={() => setCommand(row.id)}
          >
            {row.id}
          </button>
        ))}
      </div>
      <details className="advanced-launcher">
        <summary>
          <span><SlidersHorizontal size={15} />高级启动配置</span>
          <small>模型、会话、worktree、权限、工具与智能体</small>
          <ChevronDown size={15} />
        </summary>
        <div className="advanced-launcher-body">
          <div className="advanced-grid four">
            <label><span>模型 ID</span><input value={advanced.model ?? ""} onChange={(event) => setAdvancedValue("model", event.target.value)} placeholder="grok-4.6" /></label>
            <label><span>思考强度</span><input value={advanced.reasoningEffort ?? ""} onChange={(event) => setAdvancedValue("reasoningEffort", event.target.value)} placeholder="xhigh / high / medium / low" /></label>
            <label><span>权限模式</span><select value={advanced.permissionMode ?? ""} onChange={(event) => setAdvancedValue("permissionMode", event.target.value)}><option value="">CLI 默认</option><option value="default">default</option><option value="acceptEdits">acceptEdits</option><option value="auto">auto</option><option value="dontAsk">dontAsk</option><option value="plan">plan</option><option value="bypassPermissions">bypassPermissions</option></select></label>
            <label><span>沙箱配置</span><input value={advanced.sandbox ?? ""} onChange={(event) => setAdvancedValue("sandbox", event.target.value)} placeholder="由本机 Grok 配置定义" /></label>
          </div>

          <div className="advanced-grid four">
            <label><span>会话</span><select value={advanced.sessionMode ?? "new"} onChange={(event) => setAdvancedValue("sessionMode", event.target.value as AdvancedCliConfig["sessionMode"])}><option value="new">新会话</option><option value="continue">继续最近会话</option><option value="resume">恢复指定会话</option></select></label>
            <label><span>会话 ID / 标题</span><input disabled={advanced.sessionMode !== "resume"} value={advanced.resumeSession ?? ""} onChange={(event) => setAdvancedValue("resumeSession", event.target.value)} placeholder="UUID 或唯一标题" /></label>
            <label><span>最大轮数</span><input inputMode="numeric" value={advanced.maxTurns ?? ""} onChange={(event) => setAdvancedValue("maxTurns", event.target.value)} placeholder="例如 30" /></label>
            <label><span>Agent 名称或文件</span><input value={advanced.agent ?? ""} onChange={(event) => setAdvancedValue("agent", event.target.value)} placeholder="reviewer 或 .md 路径" /></label>
          </div>

          <div className="advanced-worktree">
            <label className="advanced-check"><input type="checkbox" checked={advanced.worktree !== undefined} onChange={(event) => setAdvancedValue("worktree", event.target.checked ? "" : undefined)} />新建 Git worktree</label>
            <input disabled={advanced.worktree === undefined} value={advanced.worktree ?? ""} onChange={(event) => setAdvancedValue("worktree", event.target.value)} placeholder="可选名称" />
            <input disabled={advanced.worktree === undefined} value={advanced.worktreeRef ?? ""} onChange={(event) => setAdvancedValue("worktreeRef", event.target.value)} placeholder="基准 branch/tag/commit" />
          </div>

          <div className="advanced-grid two">
            <label><span>附加规则</span><textarea value={advanced.rules ?? ""} onChange={(event) => setAdvancedValue("rules", event.target.value)} placeholder="追加到系统提示词的规则" rows={2} /></label>
            <label><span>初始任务</span><textarea value={advanced.prompt ?? ""} onChange={(event) => setAdvancedValue("prompt", event.target.value)} placeholder="留空后在 TUI 中输入" rows={2} /></label>
            <label><span>允许的内置工具</span><input value={advanced.tools ?? ""} onChange={(event) => setAdvancedValue("tools", event.target.value)} placeholder="逗号分隔" /></label>
            <label><span>禁用的内置工具</span><input value={advanced.disallowedTools ?? ""} onChange={(event) => setAdvancedValue("disallowedTools", event.target.value)} placeholder="逗号分隔" /></label>
            <label><span>子智能体 JSON</span><textarea value={advanced.subagentsJson ?? ""} onChange={(event) => setAdvancedValue("subagentsJson", event.target.value)} placeholder='{"reviewer":{"description":"Review code"}}' rows={2} /></label>
            <div className="advanced-select-row">
              <label><span>记忆</span><select value={advanced.memory ?? "default"} onChange={(event) => setAdvancedValue("memory", event.target.value as AdvancedCliConfig["memory"])}><option value="default">跟随配置</option><option value="enabled">启用实验记忆</option><option value="disabled">本次禁用</option></select></label>
              <label><span>计划</span><select value={advanced.plan ?? "default"} onChange={(event) => setAdvancedValue("plan", event.target.value as AdvancedCliConfig["plan"])}><option value="default">跟随配置</option><option value="disabled">本次禁用</option></select></label>
              <label><span>子智能体</span><select value={advanced.subagents ?? "default"} onChange={(event) => setAdvancedValue("subagents", event.target.value as AdvancedCliConfig["subagents"])}><option value="default">跟随配置</option><option value="disabled">本次禁用</option></select></label>
            </div>
          </div>

          <div className="advanced-toggles">
            <label><input type="checkbox" checked={advanced.disableWebSearch === true} onChange={(event) => setAdvancedValue("disableWebSearch", event.target.checked)} />禁用网络搜索</label>
            <label><input type="checkbox" checked={advanced.forkSession === true} onChange={(event) => setAdvancedValue("forkSession", event.target.checked)} />恢复时分叉会话</label>
            <label><input type="checkbox" checked={advanced.restoreCode === true} onChange={(event) => setAdvancedValue("restoreCode", event.target.checked)} />恢复代码快照</label>
            <label><input type="checkbox" checked={advanced.verbatim === true} onChange={(event) => setAdvancedValue("verbatim", event.target.checked)} />逐字发送任务</label>
            <label className="danger"><input type="checkbox" checked={advanced.alwaysApprove === true} onChange={(event) => setAdvancedValue("alwaysApprove", event.target.checked)} />始终批准工具</label>
          </div>
          {(advanced.alwaysApprove || advanced.permissionMode === "bypassPermissions") && (
            <div className="advanced-warning"><ShieldAlert size={16} /><span>此配置会绕过逐项审批。点击“运行”时仍会显示包含完整命令的二次确认。</span></div>
          )}
          <div className="advanced-actions">
            <button onClick={() => setAdvanced({ sessionMode: "new", memory: "default", plan: "default", subagents: "default" })}>清空</button>
            <button className="primary" onClick={applyAdvanced}>应用到命令栏</button>
          </div>
        </div>
      </details>
      <div className="terminal-surface" ref={containerRef} />
    </section>
  );
}
