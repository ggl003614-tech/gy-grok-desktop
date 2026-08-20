import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type ClipboardEvent as ReactClipboardEvent, type MouseEvent as ReactMouseEvent, type ReactNode } from "react";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { recoverDeskWindow } from "./windowPlacement";
import { open, save } from "@tauri-apps/plugin-dialog";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  AlertCircle,
  BadgeCheck,
  Bot,
  Bug,
  Check,
  ChevronDown,
  ChevronRight,
  CircleStop,
  Code2,
  Eye,
  FileCode2,
  FileDown,
  Folder,
  FolderOpen,
  GitBranch,
  History,
  LoaderCircle,
  LogIn,
  Minimize2,
  Minus,
  MousePointer2,
  ScanSearch,
  Search,
  PanelLeftOpen,
  Paperclip,
  Pencil,
  Play,
  RefreshCw,
  Send,
  ShieldAlert,
  Square,
  Sparkles,
  TerminalSquare,
  Trash2,
  Wrench,
  X,
} from "lucide-react";
import {
  GrokAcpClient,
  buildPromptParts,
  type AttachmentPayload,
  type ConnectionInfo,
  type ConnectOptions,
  type JsonObject,
  type PermissionRequest,
  type RemoteSession,
} from "./acpClient";
import {
  applyParsedUpdate,
  extractLocalPreviewUrls,
  groupTimeline,
  isInlineImageSrc,
  isSafePreviewUrl,
  localImageAbsolutePath,
  parseSessionUpdate,
  type TimelineImage,
  type TimelineItem,
  type UsageInfo,
} from "./sessionUpdates";
import {
  reduceBackgroundTasks,
  runningSummary,
  type BackgroundTask,
} from "./backgroundTasks";
import {
  appendBackground,
  captureSnapshot,
  runningThreadCount,
  shouldReleaseComposer,
  threadBadge,
  updateTarget,
  type ThreadSnapshot,
} from "./threadRuntime";
import { isPersistJobValid, schedulePersist } from "./transcriptPersist";
import { GOAL_NUDGE, decideGoalContinue, parseGoalCommand } from "./goalRunner";
import {
  lookupForConnect,
  projectPathKey,
  sameProjectPath,
  serializeTimeline,
  titleFromTranscript,
} from "./sessionMemory";
import { parseGrokTranscriptPayload } from "./grokHistory";
import { conversationEmptyKind, shouldShowConversationList } from "./conversationView";
import { formatDebugEntry } from "./debugMode";
import { contextUsagePercent } from "./extensions";
import { PreviewPanel } from "./PreviewPanel";
import { LifeBrokeDialog, LifeConfirmDialog, LifeLockScreen } from "./LifeLockScreen";
import { sortEfforts } from "./effort";
import {
  decideLifeModeChange,
  demoLifeLock,
  evaluateLifeMode,
  isLifeSealed,
  isRuntimeSealed,
  loadLifeConfig,
  loadLifeRuntime,
  normalizeLifeConfig,
  sameLifeRuntime,
  saveLifeConfig,
  saveLifeRuntime,
  stageLifeRuntime,
  type LifeConfirmRequest,
  type LifeLockReason,
  type LifeLockView,
  type LifeModeConfig,
} from "./lifeMode";
import {
  acceptLifePromise,
  inspectLifeIntegrity,
  loadCliUnlock,
  loadLifePromise,
  loadSealShadow,
  markScolded,
  normalizeLifePromise,
  sameLifePromise,
  saveCliUnlock,
  saveLifePromise,
  saveSealShadow,
  xhighRequiresPromise,
  type LifePromiseState,
} from "./lifePromise";
import "./App.css";
import { AccountMenu, ExtensionsPage, LoginDialog, OFFICIAL_BILLING_URL, OFFICIAL_USAGE_URL, periodLabel, type AccountCredits } from "./AccountHub";
import type { ThemeMode } from "./SettingsPanel";
import { Sidebar } from "./Sidebar";
import { groupSessionsByFolder } from "./sidebarTree";
import { applyThreadNames, saveThreadName } from "./threadNames";
import { ComposerPlus } from "./ComposerPlus";
import { EffortSlider } from "./EffortSlider";
import { CHECK_ACTIONS, checkPromptFor, type CheckActionId } from "./reviewActions";
import { setLocale, t, useT } from "./i18n";
import {
  applyUsageToSpend,
  emptySpend,
  isTurnSpend,
  loadThreadSpend,
  saveThreadSpend,
  type ThreadSpend,
} from "./threadSpend";
import type { ExtensionSnapshot, McpServerInfo } from "./extensions";
import { PERMISSION_MODES, normalizePermissionMode, type PermissionModeId } from "./permissionModes";
import {
  decideThreadSwitchFailure,
  planConnectFailure,
  recoverAfterDisconnect,
  resumeWarningFromError,
  shouldHonorAgentDisconnect,
  type ConnectionState,
} from "./sessionRecovery";
import brandIcon from "./assets/grok-desk-icon.png";

const TerminalPanel = lazy(async () => ({
  default: (await import("./TerminalPanel")).TerminalPanel,
}));
const ChangesPanel = lazy(async () => ({
  default: (await import("./ChangesPanel")).ChangesPanel,
}));
const FilesPanel = lazy(async () => ({
  default: (await import("./FilesPanel")).FilesPanel,
}));
const CommandCenter = lazy(async () => ({
  default: (await import("./CommandCenter")).CommandCenter,
}));
const SettingsPanel = lazy(async () => ({
  default: (await import("./SettingsPanel")).SettingsPanel,
}));

interface GrokStatus {
  available: boolean;
  version?: string;
  path?: string;
  error?: string;
  home?: string;
}

interface AccountProbe {
  authenticated: boolean;
  email?: string;
  subscriptionTier?: string;
  authMode?: string;
  teamName?: string;
  isZeroDataRetention?: boolean;
  codingDataRetentionOptOut?: boolean;
  grokPath?: string;
  error?: string;
}

interface DeviceAuth {
  url: string;
  code: string;
}

interface LoginEvent {
  kind: "stdout" | "stderr" | "exit" | "device";
  payload: string;
}

type WorkspacePage = "chat" | "sessions" | "files" | "changes" | "manage" | "terminal" | "settings" | "extensions";

interface WorkspaceRecord {
  id: string;
  path: string;
  name: string;
  lastOpenedAt: number;
}

interface LocalSessionRecord {
  id: string;
  remoteSessionId?: string;
  workspaceId: string;
  title: string;
  modelId?: string;
  reasoningEffort?: string;
  status: string;
  createdAt: number;
  updatedAt: number;
}

interface PaletteCommand {
  id: string;
  label: string;
  detail: string;
  shortcut?: string;
  disabled?: boolean;
  action: () => void;
}

interface AvailableCommand {
  name: string;
  description: string;
  hint?: string;
}

const QUICK_PROMPTS = [
  { icon: Code2, labelKey: "prompt.explain", prompt: "分析这个项目的结构，并用简洁的语言说明它是如何工作的。" },
  { icon: ScanSearch, labelKey: "prompt.review", prompt: checkPromptFor("local") },
  { icon: AlertCircle, labelKey: "prompt.issues", prompt: checkPromptFor("project") },
  { icon: FileCode2, labelKey: "prompt.structure", prompt: "评估当前代码结构，给出一个低风险、可逐步实施的重构建议。" },
];

function shortPath(path: string) {
  const parts = path.replaceAll("\\", "/").split("/").filter(Boolean);
  return parts.at(-1) || path;
}

function friendlyTier(tier?: string) {
  if (!tier) return t("account.signedIn");
  return tier
    .replace(/^x_premium$/i, "X Premium")
    .replace(/^supergrok$/i, "SuperGrok")
    .replaceAll("_", " ");
}

function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(new Error("无法读取剪贴板图片"));
    reader.readAsDataURL(file);
  });
}

function formatTokens(value?: number) {
  if (!value) return "0";
  return value > 999 ? `${(value / 1000).toFixed(1)}k` : String(value);
}

function sessionExportName(session: RemoteSession) {
  const fallback = `grok-session-${session.sessionId.slice(0, 8)}`;
  const name = (session.title || fallback)
    .replace(/[<>:"/\\|?*]/g, "-")
    .split("")
    .map((character) => (character.charCodeAt(0) < 32 ? "-" : character))
    .join("")
    .replace(/[. ]+$/g, "")
    .trim()
    .slice(0, 80);
  return `${name || fallback}.md`;
}

function permissionLabel(option: { optionId: string; name: string; kind?: string }) {
  const key = `${option.kind ?? ""} ${option.optionId} ${option.name}`.toLowerCase();
  if (key.includes("allow_always")) return t("perm.allowAlways");
  if (key.includes("allow")) return t("perm.allowOnce");
  if (key.includes("reject_always")) return t("perm.rejectAlways");
  if (key.includes("reject") || key.includes("deny")) return t("perm.reject");
  return option.name || option.optionId;
}

function permissionIsAllow(option: { optionId: string; name: string; kind?: string }) {
  return `${option.kind ?? ""} ${option.optionId} ${option.name}`
    .toLowerCase()
    .includes("allow");
}

function summarizePermission(detail: unknown): string {
  if (typeof detail === "string") {
    const line = detail.split("\n")[0]?.trim() ?? "";
    return line.length > 160 ? `${line.slice(0, 160)}…` : line || t("perm.confirm");
  }
  if (detail && typeof detail === "object") {
    const value = detail as Record<string, unknown>;
    if (typeof value.path === "string") return value.path;
    if (typeof value.file === "string") return value.file;
    if (typeof value.command === "string") return value.command.split("\n")[0] ?? "";
  }
  return t("perm.confirm");
}

function WindowControls() {
  const t = useT();
  return (
    <div className="window-controls">
      <button type="button" onClick={() => void getCurrentWindow().minimize()} aria-label={t("win.min")}>
        <Minus size={14} />
      </button>
      <button type="button" onClick={() => void getCurrentWindow().toggleMaximize()} aria-label={t("win.max")}>
        <Square size={11} />
      </button>
      <button type="button" className="win-close" onClick={() => void getCurrentWindow().close()} aria-label={t("win.close")}>
        <X size={14} />
      </button>
    </div>
  );
}

function FolderSetupCard({
  recents,
  current,
  connecting,
  path,
  onPath,
  onBrowse,
  onPick,
}: {
  recents: string[];
  current: string;
  connecting: boolean;
  path: string;
  onPath: (value: string) => void;
  onBrowse: () => void;
  onPick: (path: string) => void;
}) {
  const t = useT();
  const options = [...new Set([current, ...recents].filter(Boolean))].slice(0, 6);
  return (
    <div className="folder-setup">
      <button className="primary-action" onClick={onBrowse} disabled={connecting}>
        {connecting ? <LoaderCircle className="spin" size={17} /> : <FolderOpen size={17} />}
        {connecting ? t("folder.opening") : t("folder.choose")}
      </button>
      {options.length > 0 && (
        <div className="folder-recents">
          <span>{t("folder.recent")}</span>
          {options.map((entry) => (
            <button key={entry} onClick={() => onPick(entry)} disabled={connecting}>
              <Folder size={14} />
              <strong>{shortPath(entry)}</strong>
              <em>{entry}</em>
            </button>
          ))}
        </div>
      )}
      <div className="path-entry folder-path">
        <span>{t("folder.orPaste")}</span>
        <div>
          <input
            value={path}
            onChange={(event) => onPath(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && path.trim()) onPick(path.trim());
            }}
            placeholder="D:\\projects\\my-app"
            aria-label={t("welcome.projectPath")}
            spellCheck={false}
            disabled={connecting}
          />
          <button onClick={() => onPick(path.trim())} disabled={connecting || !path.trim()}>
            {t("common.open")}
          </button>
        </div>
      </div>
    </div>
  );
}

function App() {
  const t = useT();
  const client = useMemo(() => new GrokAcpClient(), []);
  const [connection, setConnection] = useState<ConnectionState>("checking");
  const [statusMessage, setStatusMessage] = useState(() => t("status.preparing"));
  const [bootstrapPercent, setBootstrapPercent] = useState<number>();
  const [grokVersion, setGrokVersion] = useState("");
  const [project, setProject] = useState("");
  const [connectionInfo, setConnectionInfo] = useState<ConnectionInfo>();
  const [items, setItems] = useState<TimelineItem[]>([]);
  const [usage, setUsage] = useState<UsageInfo>({});
  const [spend, setSpend] = useState<ThreadSpend>(emptySpend);
  const [permission, setPermission] = useState<PermissionRequest>();
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  // CLI 一直在后台跑命令和子智能体，只是以前全混在对话里看不出来。
  const [backgroundTasks, setBackgroundTasks] = useState<BackgroundTask[]>([]);
  // 切走的线程存这儿继续收 update。正在看的那个不在里面，它走原来的 items。
  const [threadSnapshots, setThreadSnapshots] = useState<Record<string, ThreadSnapshot>>({});
  // goal 自动续跑。实测 /goal 的下一轮在 stdio 通道上不会自己醒（TUI 里是宿主踢的，
  // 走 ACP 宿主就是我们），所以一轮正常结束后 GUI 主动补一条续跑提示。
  const [goalAutoRunning, setGoalAutoRunning] = useState(false);
  const goalActiveRef = useRef(false);
  const goalRoundsRef = useRef(0);
  const busyRef = useRef(false);
  // 插话会让两轮 prompt 短暂并存（旧的一轮被 agent 取消、新的接管）。
  // 只有最新一代才有资格在结束时解锁输入框、触发 goal 续跑。
  const turnGenRef = useRef(0);
  // 用户按停 = 明确说「别自动续了」。发新 prompt 时复位。
  const cancelledRef = useRef(false);
  // 异步回调里要读「现在看的是哪个会话」，state 会读到闭包里的旧值。
  const activeRemoteRef = useRef("");
  const threadSnapshotsRef = useRef<Record<string, ThreadSnapshot>>({});
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    const stored = Number(localStorage.getItem("grok-desk-sidebar-width"));
    return Number.isFinite(stored) && stored >= 196 && stored <= 440 ? stored : 260;
  });
  const [activityWidth, setActivityWidth] = useState(() => {
    const stored = Number(localStorage.getItem("grok-desk-activity-width"));
    return Number.isFinite(stored) && stored >= 280 && stored <= 760 ? stored : 400;
  });
  const [activityOpen, setActivityOpen] = useState(true);
  const [lifeConfig, setLifeConfig] = useState<LifeModeConfig>(() => loadLifeConfig());
  const [lifeRuntime, setLifeRuntime] = useState(() => loadLifeRuntime());
  const [lifeNow, setLifeNow] = useState(() => Date.now());
  const [lifeDemo, setLifeDemo] = useState<LifeLockReason | null>(null);
  const [lifeConfirm, setLifeConfirm] = useState<LifeConfirmRequest | null>(null);
  const [lifeSealHold, setLifeSealHold] = useState(false);
  const [lifeFormReset, setLifeFormReset] = useState(0);
  const [lifePromise, setLifePromise] = useState<LifePromiseState>(() => loadLifePromise());
  const [lifeShadowUntil, setLifeShadowUntil] = useState<string | null>(() => loadSealShadow());
  const [lifeBrokeOpen, setLifeBrokeOpen] = useState(false);
  const [lifeBrokeDemo, setLifeBrokeDemo] = useState<"scold" | "xhigh" | null>(null);
  const [lifeXhighOpen, setLifeXhighOpen] = useState(false);
  const pendingXhigh = useRef<string | null>(null);
  const [threadRestoring, setThreadRestoring] = useState(false);
  const [goMode, setGoMode] = useState(() => localStorage.getItem("grok-desk-go-mode") === "1");
  const [debugLines, setDebugLines] = useState<string[]>([]);
  const [computerControl, setComputerControl] = useState(true);
  const [computerBusy, setComputerBusy] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);
  const conversationListRef = useRef<HTMLDivElement>(null);
  const [loginOpen, setLoginOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [loginRunning, setLoginRunning] = useState(false);
  const [loginSucceeded, setLoginSucceeded] = useState(false);
  const [loginLogs, setLoginLogs] = useState<string[]>([]);
  const [account, setAccount] = useState<AccountProbe>();
  const [credits, setCredits] = useState<AccountCredits>();
  const [creditsLoading, setCreditsLoading] = useState(false);
  const [creditsError, setCreditsError] = useState("");
  const [deviceAuth, setDeviceAuth] = useState<DeviceAuth>();
  const [sidebarTab, setSidebarTab] = useState<"activity" | "preview">("activity");
  const [previewUrl, setPreviewUrl] = useState("");
  const [previewDraft, setPreviewDraft] = useState("http://localhost:5173");
  const [previewEpoch, setPreviewEpoch] = useState(0);
  const [attachments, setAttachments] = useState<AttachmentPayload[]>([]);
  const [draftConversation, setDraftConversation] = useState(false);
  const seenPreviewUrls = useRef(new Set<string>());
  const [selectedModel, setSelectedModel] = useState("");
  const [selectedEffort, setSelectedEffort] = useState("");
  const [manualProject, setManualProject] = useState("");
  const [workspacePage, setWorkspacePage] = useState<WorkspacePage>("chat");
  const [workspaceId, setWorkspaceId] = useState("");
  const [localSessionId, setLocalSessionId] = useState("");
  const [allSessions, setAllSessions] = useState<RemoteSession[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(false);
  const [sidebarQuery, setSidebarQuery] = useState("");
  const [expandedFolders, setExpandedFolders] = useState<string[]>(() => {
    try {
      const stored = JSON.parse(localStorage.getItem("grok-desk-expanded") ?? "[]");
      return Array.isArray(stored) ? stored.filter((entry) => typeof entry === "string") : [];
    } catch {
      return [];
    }
  });
  const [theme, setTheme] = useState<ThemeMode>("light");
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [paletteQuery, setPaletteQuery] = useState("");
  const [availableCommands, setAvailableCommands] = useState<AvailableCommand[]>([]);
  const [saveHistory, setSaveHistory] = useState(true);
  const [recentProjects, setRecentProjects] = useState<string[]>(() => {
    try {
      return JSON.parse(localStorage.getItem("grok-desk-projects") ?? "[]");
    } catch {
      return [];
    }
  });
  const itemsRef = useRef<TimelineItem[]>([]);
  const localSessionIdRef = useRef("");
  const lastSpendUsage = useRef<UsageInfo | undefined>(undefined);
  const spendRef = useRef<ThreadSpend>(emptySpend());
  useEffect(() => {
    projectRef.current = project;
  }, [project]);
  const persistTimer = useRef<number | undefined>(undefined);
  const pendingNewSession = useRef(false);
  const threadSwitchGen = useRef(0);
  const projectRef = useRef("");
  const connectProjectRef = useRef<(path: string, overrides?: ConnectOptions & { force?: boolean; forceNew?: boolean; retried?: boolean; assumeTrusted?: boolean }) => Promise<void>>(async () => undefined);
  const reconnectingRef = useRef(false);
  const connectInFlightRef = useRef(false);
  const connectGenerationRef = useRef(0);
  const lastConnectedAtRef = useRef(0);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const [permissionMode, setPermissionMode] = useState<PermissionModeId>("default");
  const [userHome, setUserHome] = useState("");
  const [connectors, setConnectors] = useState<McpServerInfo[]>([]);
  const [pendingTrust, setPendingTrust] = useState("");

  const addError = useCallback((message: string) => {
    setItems((current) => [
      ...current,
      { id: crypto.randomUUID(), kind: "error", text: message },
    ]);
  }, []);

  const refreshCredits = useCallback(async () => {
    setCreditsLoading(true);
    try {
      const next = await invoke<AccountCredits>("fetch_account_credits");
      setCredits(next);
      setCreditsError("");
    } catch (error) {
      setCreditsError(String(error));
    } finally {
      setCreditsLoading(false);
    }
  }, []);

  const appendDebug = useCallback((entry: Parameters<typeof formatDebugEntry>[0]) => {
    const line = formatDebugEntry(entry);
    if (!line) return;
    setDebugLines((current) => [...current.slice(-199), line]);
  }, []);

  const lifeSealedRef = useRef(false);
  const lifeSealHoldRef = useRef(false);
  const lifeConfirmRef = useRef<LifeConfirmRequest | null>(null);
  const lifeConfigRef = useRef(lifeConfig);
  const lifeEvalLockRef = useRef<LifeLockView | null>(null);
  lifeSealHoldRef.current = lifeSealHold;
  lifeConfirmRef.current = lifeConfirm;
  lifeConfigRef.current = lifeConfig;
  const persistLifeMode = useCallback((next: LifeModeConfig) => {
    if (lifeSealedRef.current) return;
    setLifeConfig(next);
    saveLifeConfig(next);
    void invoke("set_setting", { key: "life.mode", value: next }).catch(() => undefined);
  }, []);
  const lifePromiseRef = useRef(lifePromise);
  lifePromiseRef.current = lifePromise;
  const persistLifePromise = useCallback((next: LifePromiseState) => {
    lifePromiseRef.current = next;
    setLifePromise(next);
    saveLifePromise(next);
    void invoke("set_setting", { key: "life.integrity", value: next }).catch(() => undefined);
  }, []);
  const persistSealShadow = useCallback((until: string | null) => {
    setLifeShadowUntil(until);
    saveSealShadow(until);
  }, []);
  const requestLifeMode = useCallback((next: LifeModeConfig): boolean => {
    if (lifeSealedRef.current) return false;
    const now = new Date(lifeNow);
    const decision = decideLifeModeChange(lifeConfig, next, lifeRuntime, credits?.usedPercent, now);
    if (decision.action === "confirm") {
      setLifeConfirm(decision.request);
      return false;
    }
    persistLifeMode(decision.config);
    if (!isLifeSealed(evaluateLifeMode(decision.config, lifeRuntime, credits?.usedPercent, now).lock, now)) {
      setLifeSealHold(false);
    }
    return true;
  }, [credits?.usedPercent, lifeConfig, lifeNow, lifeRuntime, persistLifeMode]);
  const acceptLifeConfirm = useCallback(() => {
    if (!lifeConfirm) return;
    const now = new Date();
    persistLifeMode(lifeConfirm.next);
    if (lifeConfirm.kind === "seal" || lifeConfirm.kind === "usage") {
      const result = evaluateLifeMode(lifeConfirm.next, lifeRuntime, credits?.usedPercent, now);
      setLifeRuntime(result.runtime);
      saveLifeRuntime(result.runtime);
      if (result.runtime.lockedUntil) persistSealShadow(result.runtime.lockedUntil);
    } else {
      setLifeSealHold(false);
    }
    setLifeConfirm(null);
  }, [credits?.usedPercent, lifeConfirm, lifeRuntime, persistLifeMode, persistSealShadow]);
  const cancelLifeConfirm = useCallback(() => {
    if (!lifeConfirm) return;
    if (lifeConfirm.kind === "usage") {
      setLifeSealHold(true);
      setWorkspacePage("settings");
    }
    setLifeFormReset((value) => value + 1);
    setLifeConfirm(null);
  }, [lifeConfirm]);

  const persistGoMode = useCallback((value: boolean) => {
    setGoMode(value);
    localStorage.setItem("grok-desk-go-mode", value ? "1" : "0");
    void invoke("set_setting", { key: "debug.goMode", value }).catch(() => undefined);
  }, []);

  const handleNotification = useCallback((method: string, params: JsonObject) => {
    const sessionUpdate = method === "session/update"
      || method === "x.ai/session_notification"
      || method === "_x.ai/session_notification"
      || method === "_x.ai/session/update"
      || method.endsWith("session/update")
      || method.endsWith("session_notification");
    if (sessionUpdate) {
      appendDebug({ source: "notification", method, payload: params.update ?? params });
      const update = ((params.update && typeof params.update === "object")
        ? params.update
        : params) as JsonObject;

      // 一条 update 属于哪个线程。以前这里不看 sessionId，所有会话的输出都往
      // 同一份 items 里倒 —— 这就是为什么并发跑起来会串台。
      const from = String(params.sessionId ?? update.sessionId ?? "");
      const target = updateTarget(
        from,
        activeRemoteRef.current,
        Object.keys(threadSnapshotsRef.current),
      );
      if (target === "drop") return;
      if (target === "background") {
        const parsed = parseSessionUpdate(update);
        if (parsed.kind === "ignore") return;
        setThreadSnapshots((current) => {
          const snapshot = current[from];
          if (!snapshot) return current;
          if (parsed.kind === "usage") {
            return {
              ...current,
              [from]: { ...snapshot, usage: { ...snapshot.usage, ...parsed.usage }, updatedAt: Date.now() },
            };
          }
          const next = appendBackground(
            { ...snapshot, tasks: reduceBackgroundTasks(snapshot.tasks, update, Date.now()) },
            (items) => applyParsedUpdate(items, parsed),
            Date.now(),
          );
          return next === snapshot ? current : { ...current, [from]: next };
        });
        return;
      }
      if (update.sessionUpdate === "available_commands_update") {
        const commands = Array.isArray(update.availableCommands)
          ? update.availableCommands
          : Array.isArray(update.available_commands)
            ? update.available_commands
            : [];
        setAvailableCommands(
          commands
            .map((entry) => {
              const command = (entry ?? {}) as JsonObject;
              const commandInput = (command.input ?? {}) as JsonObject;
              return {
                name: String(command.name ?? ""),
                description: String(command.description ?? ""),
                hint:
                  typeof commandInput.hint === "string"
                    ? commandInput.hint
                    : undefined,
              };
            })
            .filter((command) => command.name),
        );
        return;
      }
      if (update.sessionUpdate === "config_option_update") {
        const configOptions = Array.isArray(update.configOptions)
          ? update.configOptions
          : [];
        setConnectionInfo((current) =>
          current
            ? {
                ...current,
                configOptions:
                  configOptions as ConnectionInfo["configOptions"],
              }
            : current,
        );
        return;
      }
      if (update.sessionUpdate === "current_mode_update") {
        const currentModeId = String(update.currentModeId ?? "");
        setConnectionInfo((current) =>
          current?.modes && currentModeId
            ? { ...current, modes: { ...current.modes, currentModeId } }
            : current,
        );
        return;
      }
      if (update.sessionUpdate === "model_changed") {
        const modelId = String(update.model_id ?? "");
        const reasoningEffort =
          typeof update.reasoning_effort === "string"
            ? update.reasoning_effort
            : "";
        if (modelId) {
          setSelectedModel(modelId);
          setSelectedEffort(reasoningEffort);
          setConnectionInfo((current) =>
            current
              ? {
                  ...current,
                  model: modelId,
                  models: current.models.map((model) =>
                    model.modelId === modelId
                      ? { ...model, reasoningEffort }
                      : model,
                  ),
                }
              : current,
          );
        }
        return;
      }
      // 后台任务跟时间线是两个视角看同一条 update：这里登记「还有什么在跑」，
      // 下面照常把它渲染进对话。认不出来时 reducer 会原样返回，React 自己会跳过。
      setBackgroundTasks((current) => reduceBackgroundTasks(current, update, Date.now()));
      const parsed = parseSessionUpdate(update);
      if (parsed.kind === "usage") {
        setUsage((current) => ({ ...current, ...parsed.usage }));
        if (parsed.usage && isTurnSpend(parsed.usage)) {
          setSpend((current) => {
            const next = applyUsageToSpend(current, parsed.usage!, lastSpendUsage.current);
            lastSpendUsage.current = parsed.usage;
            spendRef.current = next;
            return next;
          });
        }
      } else if (parsed.kind !== "ignore") {
        setItems((current) => applyParsedUpdate(current, parsed));
      }
    }
  }, [appendDebug]);

  useEffect(() => {
    client.onNotification = handleNotification;
    client.onPermission = setPermission;
    client.onStatus = (kind, payload) => {
      if (kind === "log") {
        setLogs((current) => [...current.slice(-79), payload]);
        appendDebug({ source: "log", payload });
      } else if (kind === "error") {
        addError(payload);
      } else if (kind === "disconnected") {
        const honor = shouldHonorAgentDisconnect({
          payload,
          liveGeneration: connectGenerationRef.current,
          connectInFlight: connectInFlightRef.current || reconnectingRef.current,
          lastConnectedAt: lastConnectedAtRef.current,
          now: Date.now(),
        });
        if (honor !== "reconnect") return;
        const recovered = recoverAfterDisconnect(payload, projectRef.current);
        if (recovered.reconnect && recovered.project && !reconnectingRef.current && !connectInFlightRef.current) {
          reconnectingRef.current = true;
          setStatusMessage(recovered.message);
          void connectProjectRef.current(recovered.project, { force: true })
            .finally(() => {
              reconnectingRef.current = false;
            });
        }
      }
    };

    const stopBootstrap = listen<{ phase: string; message: string; percent?: number }>(
      "grok-bootstrap",
      (event) => {
        setConnection((current) =>
          current === "checking" || current === "installing" ? "installing" : current,
        );
        setStatusMessage(event.payload.message);
        if (typeof event.payload.percent === "number") {
          setBootstrapPercent(event.payload.percent);
        }
      },
    );

    const startRuntime = async () => {
      setConnection("installing");
      setStatusMessage("正在准备 GY Grok…");
      try {
        const result = await invoke<GrokStatus>("ensure_runtime");
        if (!result.available) {
          setConnection("missing");
          setStatusMessage(result.error || "未能安装官方 Grok Build");
          return;
        }
        setGrokVersion(result.version ?? "Grok Build");
        if (result.home) setUserHome(result.home);
        setComputerControl(true);
        try {
          const snapshot = await invoke<AccountProbe>("probe_account");
          setAccount(snapshot);
          if (snapshot.authenticated) {
            setConnection("ready");
            setStatusMessage(
              snapshot.email
                ? `已登录 ${snapshot.email}，请选择项目`
                : "账户已连接，请选择一个项目",
            );
            void refreshCredits();
          } else {
            setConnection("unauthenticated");
            setStatusMessage(snapshot.error || "需要登录 Grok");
          }
        } catch (error) {
          setConnection("ready");
          setStatusMessage(`Grok 可用，但账户探测失败：${String(error)}`);
        }
      } catch (error) {
        setConnection("missing");
        setStatusMessage(String(error));
      }
    };

    void startRuntime();

    return () => {
      void stopBootstrap.then((unlisten) => unlisten());
      void client.dispose();
    };
  }, [addError, appendDebug, client, handleNotification, refreshCredits]);

  useEffect(() => {
    if (!account?.authenticated && !connectionInfo) return;
    const timer = window.setInterval(() => {
      void refreshCredits();
    }, 5 * 60 * 1000);
    return () => window.clearInterval(timer);
  }, [account?.authenticated, connectionInfo, refreshCredits]);

  useEffect(() => {
    const key = projectPathKey(project);
    if (!key) return;
    setExpandedFolders((current) => {
      if (current.includes(key)) return current;
      const next = [key, ...current].slice(0, 24);
      localStorage.setItem("grok-desk-expanded", JSON.stringify(next));
      return next;
    });
  }, [project]);

  useEffect(() => {
    void invoke<ExtensionSnapshot>("list_extensions", { cwd: project || null })
      .then((snapshot) => setConnectors(snapshot.mcpServers))
      .catch(() => undefined);
  }, [project]);

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void listen<LoginEvent>("grok-login-event", (event) => {
      const message = event.payload;
      if (message.kind === "device") {
        try {
          const device = JSON.parse(message.payload) as DeviceAuth;
          if (device.url && device.code) setDeviceAuth(device);
        } catch {
          setLoginLogs((current) => [...current.slice(-99), message.payload]);
        }
        return;
      }
      if (message.kind === "exit") {
        setLoginRunning(false);
        try {
          const result = JSON.parse(message.payload) as {
            success?: boolean;
            error?: string;
          };
          setLoginSucceeded(result.success === true);
          setLoginLogs((current) => [
            ...current,
            result.success
              ? t("login.done")
              : t("login.failed", {
                  reason: result.error ?? t("login.failedFallback"),
                }),
          ]);
          if (result.success) {
            setLoginOpen(false);
            setAccountOpen(true);
            void invoke<AccountProbe>("probe_account")
              .then((snapshot) => {
                setAccount(snapshot);
                if (snapshot.authenticated) {
                  setConnection("ready");
                  setStatusMessage(
                    snapshot.email
                      ? `已登录 ${snapshot.email}，请选择项目`
                      : "账户已连接，请选择一个项目",
                  );
                  void refreshCredits();
                }
              })
              .catch(() => undefined);
          }
        } catch {
          setLoginSucceeded(false);
          setLoginLogs((current) => [...current, message.payload]);
        }
      } else {
        setLoginLogs((current) => [...current.slice(-99), message.payload]);
      }
    }).then((cleanup) => {
      if (disposed) cleanup();
      else unlisten = cleanup;
    });
    return () => {
      disposed = true;
      unlisten?.();
    };
    // t 是模块级函数，引用稳定，进依赖不会让监听器反复重挂。
  }, [refreshCredits, t]);

  useEffect(() => {
    localSessionIdRef.current = localSessionId;
  }, [localSessionId]);

  // 这两个 ref 给异步回调用。一轮 prompt 可能跑几分钟，期间人早就切到别的线程了，
  // state 闭包里存的还是发起时那一刻的值。
  useEffect(() => {
    activeRemoteRef.current = connectionInfo?.sessionId ?? "";
  }, [connectionInfo?.sessionId]);
  useEffect(() => {
    busyRef.current = busy;
  }, [busy]);
  useEffect(() => {
    threadSnapshotsRef.current = threadSnapshots;
  }, [threadSnapshots]);

  useEffect(() => {
    const key = connectionInfo?.sessionId || localSessionId;
    lastSpendUsage.current = undefined;
    const next = loadThreadSpend(key);
    spendRef.current = next;
    setSpend(next);
  }, [connectionInfo?.sessionId, localSessionId]);

  useEffect(() => {
    spendRef.current = spend;
    const key = connectionInfo?.sessionId || localSessionId;
    if (!key) return;
    saveThreadSpend(key, spend);
    if (connectionInfo?.sessionId && localSessionId && connectionInfo.sessionId !== localSessionId) {
      saveThreadSpend(localSessionId, spend);
    }
  }, [spend, connectionInfo?.sessionId, localSessionId]);

  const persistTranscript = useCallback(
    async (
      sessionId = localSessionIdRef.current,
      // 内容显式传进来时用传进来的。不传才退回读 ref —— 那条路只有「离开前
      // 保存当前线程」在用，那一刻 items 和 sessionId 本来就是同一个线程的。
      explicitItems?: readonly TimelineItem[],
    ) => {
      if (!sessionId || !saveHistory) return;
      const items = serializeTimeline(explicitItems ? [...explicitItems] : itemsRef.current);
      if (!items.length) return;
      try {
        await invoke("save_local_transcript", { sessionId, items });
        // 标题和 remoteSessionId 是线程的身份信息。人已经切走的话，
        // 这里再写就会把旧线程的记录指到新线程的远端会话上，那条线程从此打不开。
        if (workspaceId && sessionId === localSessionIdRef.current) {
          const title = titleFromTranscript(items);
          if (title) {
            await invoke("upsert_local_session", {
              input: {
                id: sessionId,
                workspaceId,
                title,
                remoteSessionId: connectionInfo?.sessionId,
                modelId: selectedModel || undefined,
                reasoningEffort: selectedEffort || undefined,
                status: "idle",
              },
            });
          }
        }
      } catch {
        // Local history is best-effort; the live timeline stays in memory.
      }
    },
    [
      connectionInfo?.sessionId,
      saveHistory,
      selectedEffort,
      selectedModel,
      workspaceId,
    ],
  );

  const fetchTranscript = useCallback(async (sessionId?: string, remoteSessionId?: string) => {
    if (!sessionId && !remoteSessionId) return [] as TimelineItem[];
    try {
      let restored: TimelineItem[] = [];
      if (remoteSessionId) {
        restored = parseGrokTranscriptPayload(
          await invoke<unknown>("import_grok_transcript", { remoteSessionId }).catch(() => []),
        );
      }
      if (!restored.length && sessionId) {
        restored = parseGrokTranscriptPayload(
          await invoke<unknown>("load_local_transcript", { sessionId }).catch(() => []),
        );
      }
      return restored;
    } catch {
      return [] as TimelineItem[];
    }
  }, []);

  const restoreTranscript = useCallback(async (
    sessionId?: string,
    remoteSessionId?: string,
    force = false,
  ) => {
    const restored = await fetchTranscript(sessionId, remoteSessionId);
    if (!restored.length) return;
    setItems((current) => (force || current.length === 0 ? restored : current));
  }, [fetchTranscript]);

  const applyCliUsage = useCallback(async (sessionId?: string) => {
    if (!sessionId) return;
    try {
      const snapshot = await invoke<{
        contextTokensUsed?: number;
        contextWindowTokens?: number;
        contextWindowUsage?: number;
      }>("grok_session_usage", { sessionId });
      if (
        snapshot.contextTokensUsed ||
        snapshot.contextWindowTokens ||
        snapshot.contextWindowUsage
      ) {
        setUsage((current) => ({
          ...current,
          contextUsed: snapshot.contextTokensUsed ?? current.contextUsed,
          contextSize: snapshot.contextWindowTokens ?? current.contextSize,
        }));
      }
    } catch {
      // Usage lives in Grok's session files; a miss is not fatal.
    }
  }, []);

  useEffect(() => {
    itemsRef.current = items;
    if (localSessionId && saveHistory && items.length) {
      window.clearTimeout(persistTimer.current);
      // 内容在排定这一刻就取走。以前是等 400ms 后再读 itemsRef，
      // 那时候时间线可能已经换成另一个线程的了。
      const job = schedulePersist(localSessionId, items);
      persistTimer.current = window.setTimeout(() => {
        if (!job || !isPersistJobValid(job, localSessionIdRef.current)) return;
        void persistTranscript(job.sessionId, job.items);
      }, 400);
    }
    for (const item of items) {
      for (const url of extractLocalPreviewUrls(`${item.title ?? ""} ${item.text}`)) {
        if (seenPreviewUrls.current.has(url)) continue;
        seenPreviewUrls.current.add(url);
        setPreviewUrl(url);
        setPreviewDraft(url);
        setSidebarTab("preview");
        setActivityOpen(true);
      }
    }
    return () => window.clearTimeout(persistTimer.current);
  }, [items, localSessionId, persistTranscript, saveHistory]);

  useEffect(() => {
    void invoke<WorkspaceRecord[]>("list_workspaces")
      .then((workspaces) => {
        setRecentProjects((current) => [
          ...workspaces.map((workspace) => workspace.path),
          ...current.filter(
            (path) => !workspaces.some((workspace) => workspace.path === path),
          ),
        ].slice(0, 8));
      })
      .catch(() => undefined);
    void invoke<RemoteSession[]>("list_grok_sessions", { cwd: null })
      .then((sessions) => setAllSessions(applyThreadNames(sessions)))
      .catch(() => undefined);
    void invoke<ExtensionSnapshot>("list_extensions", { cwd: null })
      .then((snapshot) => setConnectors(snapshot.mcpServers))
      .catch(() => undefined);
    void invoke<Record<string, unknown>>("get_settings")
      .then((settings) => {
        const storedTheme = settings["appearance.theme"];
        if (storedTheme === "system" || storedTheme === "dark" || storedTheme === "light") {
          setTheme(storedTheme);
        }
        if (settings["appearance.locale"] === "en" || settings["appearance.locale"] === "zh") {
          setLocale(settings["appearance.locale"]);
        }
        if (typeof settings["privacy.saveHistory"] === "boolean") {
          setSaveHistory(settings["privacy.saveHistory"] as boolean);
        }
        if (typeof settings["debug.goMode"] === "boolean") {
          setGoMode(settings["debug.goMode"] as boolean);
        }
        if (settings["agent.permissionMode"]) {
          setPermissionMode(normalizePermissionMode(settings["agent.permissionMode"]));
        }
        if (settings["life.mode"]) {
          setLifeConfig(normalizeLifeConfig(settings["life.mode"]));
        }
        if (settings["life.integrity"]) {
          const stored = normalizeLifePromise(settings["life.integrity"]);
          const hasLocal = (() => {
            try {
              return window.localStorage.getItem("grok-desk.life-mode.promise") != null;
            } catch {
              return false;
            }
          })();
          if (!hasLocal && (stored.xhighBlocked || stored.broken)) {
            setLifePromise(stored);
            saveLifePromise(stored);
          }
        }
        if (settings["desktop.control"] === false) {
          setComputerControl(false);
          return;
        }
        void invoke("set_computer_control", { enabled: true })
          .then(() => setComputerControl(true))
          .catch(() => undefined);
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    void recoverDeskWindow(getCurrentWindow()).catch(() => undefined);
  }, []);

  // 拦住所有 http(s) 链接。WebView 里点一个原生 <a> 会把整个 app 导航到那个网页 ——
  // 界面连同标题栏一起消失，用户只能杀进程。助手回复里随手一个 localhost 链接
  // 就能触发，所以这里统一接管：本机地址进预览栏，其余交给系统浏览器。
  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0) return;
      const target = event.target as HTMLElement | null;
      const anchor = target?.closest?.("a");
      if (!anchor) return;
      const href = anchor.getAttribute("href")?.trim() ?? "";
      if (!/^https?:\/\//i.test(href)) return; // 锚点、blob:、asset: 图片照常
      event.preventDefault();
      if (isSafePreviewUrl(href)) {
        setPreviewUrl(href);
        setPreviewDraft(href);
        setSidebarTab("preview");
        setActivityOpen(true);
        return;
      }
      void invoke("open_external_url", { url: href }).catch((error) =>
        addError(String(error)),
      );
    };
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, [addError]);

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: light)");
    const apply = () => {
      document.documentElement.dataset.theme =
        theme === "system" ? (media.matches ? "light" : "dark") : theme;
    };
    apply();
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [theme]);

  const rememberProject = useCallback((path: string) => {
    setRecentProjects((current) => {
      const next = [path, ...current.filter((entry) => entry !== path)].slice(0, 6);
      localStorage.setItem("grok-desk-projects", JSON.stringify(next));
      return next;
    });
    const key = projectPathKey(path);
    if (!key) return;
    setExpandedFolders((current) => {
      if (current.includes(key)) return current;
      const next = [key, ...current].slice(0, 24);
      localStorage.setItem("grok-desk-expanded", JSON.stringify(next));
      return next;
    });
  }, []);

  const refreshAllSessions = useCallback(async () => {
    setSessionsLoading(true);
    try {
      const sessions = await invoke<RemoteSession[]>("list_grok_sessions", { cwd: null });
      setAllSessions(applyThreadNames(sessions));
    } catch (error) {
      addError(String(error));
    } finally {
      setSessionsLoading(false);
    }
  }, [addError]);

  const connectProject = useCallback(
    async (path: string, overrides: ConnectOptions & { force?: boolean; forceNew?: boolean; retried?: boolean; assumeTrusted?: boolean } = {}) => {
      if (!path) return;
      if (
        !overrides.force &&
        sameProjectPath(path, project) &&
        connection === "connected" &&
        !draftConversation
      ) {
        setWorkspacePage("chat");
        setDraftConversation(false);
        return;
      }
      connectInFlightRef.current = true;
      connectGenerationRef.current += 1;
      await persistTranscript();
      let workspace: WorkspaceRecord | undefined;
      try {
        const known = await invoke<WorkspaceRecord[]>("list_workspaces");
        const trusted = known.some((entry) => sameProjectPath(entry.path, path));
        if (!trusted && !overrides.assumeTrusted) {
          setPendingTrust(path);
          setProject(path);
          setWorkspacePage("chat");
          setDraftConversation(true);
          setConnection("ready");
          setStatusMessage("请确认是否信任这个文件夹");
          connectInFlightRef.current = false;
          return;
        }
        setPendingTrust("");
        workspace = await invoke<WorkspaceRecord>("upsert_workspace", { path });
        setWorkspaceId(workspace.id);
        rememberProject(workspace.path);
        path = workspace.path;
      } catch (error) {
        setConnection("error");
        setStatusMessage(String(error));
        addError(String(error));
        connectInFlightRef.current = false;
        return;
      }
      const previous = await invoke<LocalSessionRecord[]>("list_local_sessions", {
        workspaceId: workspace.id,
      }).catch(() => [] as LocalSessionRecord[]);
      const latest = previous[0];
      const lookup = lookupForConnect(
        previous,
        overrides.resumeSessionId,
        overrides.forceNew === true,
      );
      setProject(path);
      setConnection("connecting");
      setStatusMessage("正在连接 Grok Build…");
      let previewAlreadyVisible = false;
      if (overrides.forceNew || !lookup.requireResume) {
        setItems([]);
        setThreadRestoring(false);
      } else {
        setThreadRestoring(true);
        const preview = await fetchTranscript(lookup.localId, lookup.remoteId);
        previewAlreadyVisible = preview.length > 0;
        setItems(preview);
      }
      setUsage({});
      setPermission(undefined);
      setAvailableCommands([]);
      try {
        const info = await client.connect(path, {
          model: overrides.model || undefined,
          reasoningEffort: overrides.reasoningEffort || undefined,
          alwaysApprove: permissionMode === "bypassPermissions",
          permissionMode,
          debug: goMode,
          requireResume: lookup.requireResume,
          resumeSessionId: lookup.remoteId,
        });
        setConnectionInfo(info);
        if (info.model) setSelectedModel(info.model);
        const activeModel = info.models.find((model) => model.modelId === info.model);
        setSelectedEffort(
          overrides.reasoningEffort ??
            activeModel?.reasoningEffort ??
            activeModel?.reasoningEfforts.find((effort) => effort.isDefault)?.value ??
            activeModel?.reasoningEfforts[0]?.value ??
            selectedEffort,
        );
        setConnection("connected");
        setDraftConversation(false);
        lastConnectedAtRef.current = Date.now();
        setStatusMessage(info.resumeWarning || "已连接");
        if (info.resumeWarning) addError(info.resumeWarning);
        rememberProject(path);
        const matched = previous.find((entry) => entry.remoteSessionId === info.sessionId);
        const localSession = await invoke<LocalSessionRecord>(
          "upsert_local_session",
          {
            input: {
              id: overrides.forceNew ? undefined : matched?.id,
              remoteSessionId: info.sessionId,
              workspaceId: workspace.id,
              title: matched?.title || latest?.title || "New task",
              modelId: info.model,
              reasoningEffort:
                overrides.reasoningEffort ??
                activeModel?.reasoningEffort ??
                undefined,
              status: "idle",
            },
          },
        );
        setLocalSessionId(localSession.id);
        if (overrides.forceNew) {
          setItems([]);
        } else if (!previewAlreadyVisible) {
          await restoreTranscript(localSession.id, info.sessionId, true);
        }
        await applyCliUsage(info.sessionId);
        void refreshAllSessions();
      } catch (error) {
        const planned = planConnectFailure(error, overrides.retried === true);
        if (planned.action === "retry") {
          await connectProject(path, { ...overrides, force: true, retried: true });
          return;
        }
        setConnection(planned.state);
        setStatusMessage(planned.message);
        addError(planned.message);
      } finally {
        setThreadRestoring(false);
        connectInFlightRef.current = false;
      }
    },
    [
      addError,
      client,
      connection,
      draftConversation,
      applyCliUsage,
      fetchTranscript,
      persistTranscript,
      permissionMode,
      goMode,
      project,
      rememberProject,
      restoreTranscript,
      refreshAllSessions,
    ],
  );

  connectProjectRef.current = connectProject;

  const chooseProject = async () => {
    await persistTranscript();
    pendingNewSession.current = false;
    setWorkspacePage("chat");
    setDraftConversation(true);
    setAttachments([]);
    setStatusMessage("请在这场对话里选择文件夹");
  };

  const browseFolder = async () => {
    const selected = await open({
      directory: true,
      multiple: false,
      title: "选择这个对话要处理的文件夹",
    });
    if (typeof selected === "string") await bindConversationFolder(selected);
  };

  const bindConversationFolder = async (path: string) => {
    const next = path.replaceAll("/", "\\").replace(/[\\]+$/, "").toLowerCase();
    const current = project.replaceAll("/", "\\").replace(/[\\]+$/, "").toLowerCase();
    setAttachments([]);
    if (connection === "connected" && next === current) {
      setDraftConversation(false);
      setWorkspacePage("chat");
      if (pendingNewSession.current) {
        pendingNewSession.current = false;
        await startNewSession();
        return;
      }
      setStatusMessage("已回到当前项目");
      return;
    }
    await connectProject(path);
  };

  const lifeNowDate = new Date(lifeNow);
  const lifeEval = evaluateLifeMode(
    lifeConfig,
    lifeRuntime,
    credits?.usedPercent,
    lifeNowDate,
  );
  const stagedLife = stageLifeRuntime(lifeRuntime, lifeEval.runtime, lifeNowDate);
  const lifeSealed = !lifeDemo && isRuntimeSealed(stagedLife.runtime, lifeNowDate);
  const lifeLock: LifeLockView = lifeDemo
    ? demoLifeLock(lifeDemo, lifeNowDate)
    : lifeSealed
      ? lifeEval.lock
      : { ...lifeEval.lock, locked: false, reason: null, until: null };
  lifeSealedRef.current = lifeSealed;
  lifeEvalLockRef.current = lifeEval.lock;

  useEffect(() => {
    if (!sameLifeRuntime(lifeRuntime, stagedLife.runtime)) {
      const becameSealed = Boolean(stagedLife.runtime.lockedUntil) && !lifeRuntime.lockedUntil;
      setLifeRuntime(stagedLife.runtime);
      saveLifeRuntime(stagedLife.runtime);
      if (becameSealed && stagedLife.runtime.lockedUntil) persistSealShadow(stagedLife.runtime.lockedUntil);
    }
  }, [lifeEval.runtime, lifeRuntime, persistSealShadow, stagedLife.runtime]);

  useEffect(() => {
    const inspected = inspectLifeIntegrity({
      runtime: lifeRuntime,
      promise: lifePromise,
      shadowUntil: lifeShadowUntil,
      cliUnlock: loadCliUnlock(),
      now: new Date(lifeNow),
    });
    if (!sameLifePromise(lifePromise, inspected.promise)) persistLifePromise(inspected.promise);
    if (inspected.clearShadow && lifeShadowUntil) persistSealShadow(null);
    if (inspected.consumeCli) saveCliUnlock(null);
    if (inspected.promise.broken && !inspected.promise.scolded) setLifeBrokeOpen(true);
  }, [lifeNow, lifePromise, lifeRuntime, lifeShadowUntil, persistLifePromise, persistSealShadow]);

  useEffect(() => {
    const tick = window.setInterval(() => setLifeNow(Date.now()), 15_000);
    return () => window.clearInterval(tick);
  }, []);

  useEffect(() => {
    if (!lifeConfig.enabled) return;
    void refreshCredits();
    const poll = window.setInterval(() => void refreshCredits(), 90_000);
    return () => window.clearInterval(poll);
  }, [lifeConfig.enabled, refreshCredits]);

  /**
   * 一轮结束后决定要不要替 goal 踢下一轮。踢的话延迟一拍再发，
   * 让 React 先把 busy=false 落地，也给用户一个插话的空隙。
   */
  const maybeContinueGoal = (finishedSessionId: string) => {
    const lastAssistant = [...itemsRef.current]
      .reverse()
      .find((item) => item.kind === "assistant" && item.text.trim());
    const decision = decideGoalContinue({
      goalActive: goalActiveRef.current,
      cancelled: cancelledRef.current,
      autoRounds: goalRoundsRef.current,
      lifeLocked: lifeLock.locked,
      sameSession: finishedSessionId === activeRemoteRef.current,
      lastAssistantText: lastAssistant?.text ?? "",
    });
    if (!decision.continue) {
      // switched 只是暂停（切回来下一轮结束后还会试）；其余情况彻底收摊。
      if (decision.reason !== "switched" && decision.reason !== "inactive") {
        goalActiveRef.current = decision.reason === "locked" ? goalActiveRef.current : false;
        setGoalAutoRunning(false);
        if (decision.reason === "done") setStatusMessage(t("goal.finished"));
        if (decision.reason === "cap") setStatusMessage(t("goal.capped"));
      }
      return;
    }
    goalRoundsRef.current += 1;
    setStatusMessage(t("goal.round", { n: goalRoundsRef.current }));
    window.setTimeout(() => {
      // 空隙期间用户开始打字或点了停，就把这一轮让给人。
      if (!goalActiveRef.current || busyRef.current) return;
      void sendPrompt(GOAL_NUDGE);
    }, 1200);
  };

  const sendPrompt = async (value = input) => {
    const prompt = value.trim();
    if (lifeLock.locked) return;
    if (connection !== "connected" || draftConversation) return;
    // 忙的时候照样能发 —— 这就是「插话」。实测同一会话再发一条 prompt，
    // 正在跑的那轮会立刻以 cancelled 收场、新的接管，跟 TUI 的
    // 「send a message to interrupt」同一机制。
    if (!prompt && attachments.length === 0) return;
    const pending = attachments;
    const parts = buildPromptParts(
      prompt,
      pending,
      connectionInfo?.capabilities.promptImage === true,
    );
    const images = pending
      .filter((file) => file.kind === "image" && file.dataUrl)
      .map((file) => ({ src: file.dataUrl!, alt: file.name }));
    setItems((current) => [
      ...current,
      {
        id: crypto.randomUUID(),
        kind: "user",
        text: prompt,
        images: images.length ? images : undefined,
        source: "local",
      },
    ]);
    setInput("");
    setAttachments([]);
    setBusy(true);
    cancelledRef.current = false;
    const myGen = ++turnGenRef.current;
    // 这一轮属于哪个会话，在发出去那一刻就钉死。中途人切走了，回来的结果
    // 也还得算回这个线程头上，不能落到人眼前的那个。
    const turnSessionId = connectionInfo?.sessionId ?? client.activeSessionId;
    // 用户亲手输入的 /goal 命令改变续跑状态；自动续跑发出的 nudge 不走这里。
    const goalCommand = parseGoalCommand(prompt);
    if (goalCommand === "start" || goalCommand === "resume") {
      goalActiveRef.current = true;
      goalRoundsRef.current = 0;
      setGoalAutoRunning(true);
    } else if (goalCommand === "stop") {
      goalActiveRef.current = false;
      setGoalAutoRunning(false);
    } else if (goalCommand === null && goalActiveRef.current) {
      // 人插话了：自动轮数归零，人说的话优先，但 goal 状态不变。
      goalRoundsRef.current = 0;
    }
    if (localSessionId && saveHistory) {
      void invoke("append_local_message", {
        sessionId: localSessionId,
        role: "user",
        kind: "text",
        content: { text: prompt, attachments: pending.map((file) => file.name) },
      }).catch(() => undefined);
    }
    try {
      await client.prompt(parts, turnSessionId);
      const response = [...itemsRef.current]
        .reverse()
        .find((item) => item.kind === "assistant" && item.text.trim());
      if (localSessionId && response && saveHistory) {
        void invoke("append_local_message", {
          sessionId: localSessionId,
          role: "assistant",
          kind: "markdown",
          content: { text: response.text },
        }).catch(() => undefined);
      }
    } catch (error) {
      addError(String(error));
    } finally {
      // 被插话顶掉的旧一轮什么都不碰，状态归新一轮管（finally 里不用
      // return —— 那会吞掉 try 里的控制流）。
      // 人还在这个线程上才解锁输入框；已经切走的话，要解的是快照里那个 busy,
      // 否则会把眼前这个线程的输入框错误地解开。
      if (myGen !== turnGenRef.current) {
        // 旧轮收尾只剩刷新额度这一件事，在下面统一做。
      } else if (shouldReleaseComposer(turnSessionId, activeRemoteRef.current)) {
        setBusy(false);
        maybeContinueGoal(turnSessionId);
      } else {
        setThreadSnapshots((current) => {
          const snapshot = current[turnSessionId];
          return snapshot
            ? { ...current, [turnSessionId]: { ...snapshot, busy: false, updatedAt: Date.now() } }
            : current;
        });
      }
      if (lifeConfig.enabled) void refreshCredits();
    }
  };

  const cancelPrompt = async () => {
    // 人按了停：这一轮取消，goal 自动续跑也一起收摊 —— 停就是停，
    // 不能过 1.2 秒又自己爬起来。
    cancelledRef.current = true;
    goalActiveRef.current = false;
    setGoalAutoRunning(false);
    await client.cancel(connectionInfo?.sessionId);
    setBusy(false);
  };

  /**
   * 停掉一个后台任务（后台命令或子智能体）。
   *
   * GUI 没法直接调 kill_command_or_subagent —— 那是 agent 的工具，77 个斜杠命令里
   * 也没有对应的入口。唯一的路是发一条 prompt 让 Grok 自己去调。
   *
   * 实测过代价：同一个会话上再发一条 prompt，正在跑的那一轮会直接返回 cancelled。
   * 也就是说「停这个任务」必然打断当前这轮对话。按钮提示里写清楚了。
   */
  const stopBackgroundTask = async (task: BackgroundTask) => {
    const target = connectionInfo?.sessionId ?? client.activeSessionId;
    if (!target) return;
    setItems((current) => [
      ...current,
      {
        id: crypto.randomUUID(),
        kind: "status",
        title: t("tasks.stopping"),
        text: task.title || task.id,
      },
    ]);
    setBusy(true);
    try {
      await client.prompt(
        `使用 kill_command_or_subagent 停掉任务 ${task.id}，然后用一句话告诉我结果。`,
        target,
      );
    } catch (error) {
      addError(String(error));
    } finally {
      if (shouldReleaseComposer(target, activeRemoteRef.current)) setBusy(false);
    }
  };

  /**
   * 删除一条线程：远端会话、本地记录、后台快照一起清。
   * 正在跑的先停掉再删；删的是眼前这条时，回到新对话的空状态。
   */
  const deleteThread = async (session: RemoteSession) => {
    const sessionId = session.sessionId;
    try {
      if (threadSnapshotsRef.current[sessionId]?.busy) {
        await client.cancel(sessionId);
      }
      if (connectionInfo?.capabilities.deleteSession) {
        await client.deleteSession(sessionId);
      } else {
        await invoke("delete_grok_session", { sessionId });
      }
      // 本地记录按远端 id 找。找不到就算了 —— 远端已经删干净了。
      if (workspaceId) {
        const locals = await invoke<LocalSessionRecord[]>("list_local_sessions", { workspaceId })
          .catch(() => [] as LocalSessionRecord[]);
        for (const record of locals.filter((entry) => entry.remoteSessionId === sessionId)) {
          await invoke("delete_local_session", { id: record.id }).catch(() => undefined);
        }
      }
      setThreadSnapshots((current) => {
        if (!current[sessionId]) return current;
        const rest = { ...current };
        delete rest[sessionId];
        threadSnapshotsRef.current = rest;
        return rest;
      });
      // 删的是当前打开的线程：不能停在一个已经不存在的会话上。
      if (connectionInfo?.sessionId === sessionId) {
        ++threadSwitchGen.current;
        localSessionIdRef.current = "";
        setLocalSessionId("");
        setItems([]);
        setUsage({});
        setBackgroundTasks([]);
        setBusy(false);
        setPermission(undefined);
        setDraftConversation(true);
      }
      setStatusMessage(t("sidebar.deleted"));
      void refreshAllSessions();
    } catch (error) {
      addError(String(error));
    }
  };

  /** 停掉某个后台线程，不用先切过去。 */
  const cancelThread = async (sessionId: string) => {
    await client.cancel(sessionId);
    setThreadSnapshots((current) => {
      const snapshot = current[sessionId];
      return snapshot
        ? { ...current, [sessionId]: { ...snapshot, busy: false, updatedAt: Date.now() } }
        : current;
    });
  };

  const runCheck = (id: CheckActionId) => {
    setWorkspacePage("chat");
    void sendPrompt(checkPromptFor(id, availableCommands));
  };

  const startNewConversation = async () => {
    if (lifeLock.locked && !lifeDemo) return;
    if (connection === "checking" || connection === "installing" || connection === "missing") {
      addError(statusMessage || "还没有可用的 Grok Build");
      return;
    }
    const target = project || recentProjects[0] || userHome;
    if (project && connection === "connected") {
      await startNewSession();
      return;
    }
    if (target) {
      pendingNewSession.current = true;
      await connectProject(target, { force: true, forceNew: true });
      return;
    }
    await persistTranscript();
    pendingNewSession.current = true;
    setWorkspacePage("chat");
    setDraftConversation(true);
    setItems([]);
    setAttachments([]);
    setUsage({});
    setPermission(undefined);
    setAvailableCommands([]);
    setInput("");
    setLocalSessionId("");
    setStatusMessage("新线程已开始，将放到「其他」");
  };

  const attachmentRoot = project || userHome;

  const addImportedFiles = (imported: AttachmentPayload[]) => {
    setAttachments((current) => [...current, ...imported].slice(0, 12));
  };

  const captureDesktop = async () => {
    const root = attachmentRoot;
    if (!root) {
      addError("先选择一个文件夹，再截图给 Grok");
      return;
    }
    try {
      const shot = await invoke<{ dataUrl: string }>("take_screenshot");
      const imported = await invoke<AttachmentPayload>("import_data_url", {
        root,
        name: "desktop.png",
        dataUrl: shot.dataUrl,
      });
      addImportedFiles([imported]);
      setStatusMessage("已截取屏幕，发送后 Grok 就能看见");
    } catch (error) {
      addError(String(error));
    }
  };

  const pickAttachments = async () => {
    const root = attachmentRoot;
    if (!root) {
      setDraftConversation(true);
      setStatusMessage("先选择一个文件夹，再添加文件");
      return;
    }
    const selected = await open({
      multiple: true,
      title: "添加文件或照片",
      filters: [
        { name: "图片", extensions: ["png", "jpg", "jpeg", "gif", "webp", "bmp"] },
        { name: "文档", extensions: ["txt", "md", "pdf", "json", "csv", "docx"] },
        { name: "所有文件", extensions: ["*"] },
      ],
    });
    const paths = Array.isArray(selected) ? selected : selected ? [selected] : [];
    if (!paths.length) return;
    try {
      addImportedFiles(
        await invoke<AttachmentPayload[]>("import_attachments", { root, paths }),
      );
    } catch (error) {
      addError(String(error));
    }
  };

  const pickAttachmentFolder = async () => {
    const selected = await open({
      directory: true,
      multiple: false,
      title: "选择要附加的文件夹",
    });
    if (typeof selected !== "string") return;
    const root = project || selected;
    try {
      if (!project) await bindConversationFolder(selected);
      addImportedFiles(
        await invoke<AttachmentPayload[]>("import_folder", { root, folder: selected }),
      );
    } catch (error) {
      addError(String(error));
    }
  };

  const pasteClipboard = async (event: ReactClipboardEvent<HTMLElement>) => {
    const items = event.clipboardData?.items;
    if (!items?.length) return;
    const images: File[] = [];
    for (const item of items) {
      if (item.type.startsWith("image/")) {
        const file = item.getAsFile();
        if (file) images.push(file);
      }
    }
    if (!images.length) return;
    event.preventDefault();
    const root = attachmentRoot;
    if (!root) {
      addError("先选择一个文件夹，再粘贴截图");
      return;
    }
    try {
      for (const [index, file] of images.entries()) {
        const dataUrl = await readFileAsDataUrl(file);
        const imported = await invoke<AttachmentPayload>("import_data_url", {
          root,
          name: file.name || `screenshot-${index + 1}.png`,
          dataUrl,
        });
        addImportedFiles([imported]);
      }
    } catch (error) {
      addError(String(error));
    }
  };

  const startNewSession = async () => {
    if (connection !== "connected") {
      setDraftConversation(true);
      setWorkspacePage("chat");
      return;
    }
    await persistTranscript();
    setWorkspacePage("chat");
    setDraftConversation(false);
    try {
      // 先封存再开新的。newSession 不重启进程，旧线程还在后台跑着。
      stashActiveThread();
      const remoteSessionId = await client.newSession();
      if (selectedModel) {
        await client.setSessionModel(selectedModel, selectedEffort || undefined);
      }
      setItems([]);
      setUsage({});
      setBackgroundTasks([]);
      setBusy(false);
      setPermission(undefined);
      setAvailableCommands([]);
      activeRemoteRef.current = remoteSessionId;
      setConnectionInfo((current) =>
        current ? { ...current, sessionId: remoteSessionId } : current,
      );
      if (workspaceId) {
        const localSession = await invoke<LocalSessionRecord>(
          "upsert_local_session",
          {
            input: {
              remoteSessionId,
              workspaceId,
              title: "New task",
              modelId: selectedModel || undefined,
              reasoningEffort: selectedEffort || undefined,
              status: "idle",
            },
          },
        );
        setLocalSessionId(localSession.id);
      }
      setStatusMessage("已创建新线程");
      void refreshAllSessions();
    } catch (error) {
      addError(String(error));
    }
  };

  const refreshSessions = refreshAllSessions;

  const openThreadFromTree = async (session: RemoteSession) => {
    const target = session.cwd || project || userHome;
    if (!target) {
      addError("这个线程没有绑定文件夹");
      return;
    }
    setWorkspacePage("chat");
    setDraftConversation(false);
    if (sameProjectPath(target, project) && connection === "connected") {
      await openRemoteSession(session);
      return;
    }
    await connectProject(target, { resumeSessionId: session.sessionId, force: true });
  };

  const startThreadInFolder = async (path: string) => {
    const target = path || userHome || recentProjects[0];
    if (!target) {
      await startNewConversation();
      return;
    }
    setWorkspacePage("chat");
    if (sameProjectPath(target, project) && connection === "connected") {
      await startNewSession();
      return;
    }
    pendingNewSession.current = true;
    await connectProject(target, { force: true, forceNew: true });
  };

  const toggleFolder = (key: string) => {
    setExpandedFolders((current) => {
      const next = current.includes(key)
        ? current.filter((entry) => entry !== key)
        : [key, ...current];
      localStorage.setItem("grok-desk-expanded", JSON.stringify(next));
      return next;
    });
  };

  /**
   * 把当前线程封存进快照。离开它之前必须调一次 —— 不然它后续的 update
   * 会因为「既不是当前会话、也不在缓冲区」被判成陌生会话丢掉，
   * 那个线程就等于在后台白跑。
   */
  const stashActiveThread = () => {
    const leaving = connectionInfo?.sessionId ?? "";
    if (!leaving) return;
    const snapshot = captureSnapshot(
      leaving,
      { items: itemsRef.current, usage, tasks: backgroundTasks, busy },
      Date.now(),
    );
    threadSnapshotsRef.current = { ...threadSnapshotsRef.current, [leaving]: snapshot };
    setThreadSnapshots((current) => ({ ...current, [leaving]: snapshot }));
  };

  const openRemoteSession = async (session: RemoteSession) => {
    if (connectionInfo?.sessionId === session.sessionId) {
      setWorkspacePage("chat");
      return;
    }

    stashActiveThread();

    // 目标线程还在本进程里开着 —— 换个指针就行，不重连、不重放历史，
    // 更不能走 loadSession，那会把它正在跑的一轮打断。
    const cached = threadSnapshotsRef.current[session.sessionId];
    if (cached) {
      ++threadSwitchGen.current;
      client.focusSession(session.sessionId);
      activeRemoteRef.current = session.sessionId;
      setItems(cached.items);
      setUsage(cached.usage);
      setBackgroundTasks(cached.tasks);
      setBusy(cached.busy);
      setPermission(undefined);
      setThreadRestoring(false);
      const rest = { ...threadSnapshotsRef.current };
      delete rest[session.sessionId];
      threadSnapshotsRef.current = rest;
      setThreadSnapshots(rest);
      setConnectionInfo((current) =>
        current ? { ...current, sessionId: session.sessionId } : current,
      );
      setWorkspacePage("chat");
      return;
    }

    const gen = ++threadSwitchGen.current;
    await persistTranscript();
    setThreadRestoring(true);
    setItems([]);
    const existing = workspaceId
      ? await invoke<LocalSessionRecord[]>("list_local_sessions", { workspaceId }).catch(() => [] as LocalSessionRecord[])
      : [];
    const known = existing.find((entry) => entry.remoteSessionId === session.sessionId);
    const restored = await fetchTranscript(known?.id, session.sessionId);
    if (gen !== threadSwitchGen.current) return;
    // 这一行必须紧挨着 setItems。以前 localSessionId 要等 loadSession 和
    // upsert_local_session 两次往返之后才更新，中间那段时间「时间线是新线程的、
    // 存档 id 还是旧线程的」，自动保存一响就把新线程的对话覆盖到旧线程头上。
    // 还没有本地记录时先置空，宁可这一小段不存，也不能存错。
    localSessionIdRef.current = known?.id ?? "";
    setLocalSessionId(known?.id ?? "");
    setItems(restored);
    if (restored.length) setThreadRestoring(false);
    setUsage({});
    setPermission(undefined);
    setAvailableCommands([]);
    setBusy(true);
    try {
      if (connectionInfo?.capabilities.loadSession) {
        await client.loadSession(session.sessionId);
      } else if (connectionInfo?.capabilities.resumeSession) {
        await client.resumeSession(session.sessionId);
      } else {
        throw new Error("当前 Grok Build 不支持恢复会话");
      }
      if (gen !== threadSwitchGen.current) return;
      setConnectionInfo((current) =>
        current ? { ...current, sessionId: session.sessionId } : current,
      );
      if (workspaceId) {
        const local = await invoke<LocalSessionRecord>("upsert_local_session", {
          input: {
            id: known?.id,
            remoteSessionId: session.sessionId,
            workspaceId,
            title: session.title ?? known?.title ?? "Recovered task",
            modelId: connectionInfo?.model,
            reasoningEffort: selectedEffort || undefined,
            status: "idle",
          },
        });
        setLocalSessionId(local.id);
        if (!restored.length) {
          await restoreTranscript(local.id, session.sessionId, true);
        }
      }
      await applyCliUsage(session.sessionId);
      setWorkspacePage("chat");
    } catch (error) {
      const action = decideThreadSwitchFailure(
        error,
        connectInFlightRef.current || reconnectingRef.current,
      );
      if (action === "ignore") {
        return;
      }
      if (action === "reconnect") {
        const target = session.cwd || project;
        if (target) {
          await connectProject(target, {
            resumeSessionId: session.sessionId,
            force: true,
          });
        }
        return;
      }
      try {
        const fallbackId = await client.newSession();
        setConnection("connected");
        setDraftConversation(false);
        setConnectionInfo((current) =>
          current
            ? {
                ...current,
                sessionId: fallbackId,
                resumeWarning: resumeWarningFromError(error, session.sessionId),
              }
            : current,
        );
        addError(resumeWarningFromError(error, session.sessionId));
      } catch (fallbackError) {
        addError(`切入线程失败，已保留本地记录。${String(fallbackError)}`);
      }
    } finally {
      if (gen === threadSwitchGen.current) {
        setBusy(false);
        setThreadRestoring(false);
      }
    }
  };

  const renameRemoteSession = async (session: RemoteSession, nextTitle?: string) => {
    const title = (nextTitle ?? window.prompt("给这个线程起个名字", session.title ?? "") ?? "").trim();
    if (!title || title === session.title) return;
    saveThreadName(session.sessionId, title);
    setAllSessions((current) =>
      current.map((entry) =>
        entry.sessionId === session.sessionId ? { ...entry, title } : entry,
      ),
    );
    if (!workspaceId) {
      setStatusMessage("线程名称已保存");
      return;
    }
    try {
      await invoke<LocalSessionRecord>("upsert_local_session", {
        input: {
          remoteSessionId: session.sessionId,
          workspaceId,
          title,
          modelId: connectionInfo?.model,
          reasoningEffort: selectedEffort || undefined,
          status: "idle",
        },
      });
      setStatusMessage("线程名称已保存");
    } catch (error) {
      addError(String(error));
    }
  };

  const exportRemoteSession = async (session: RemoteSession) => {
    const cwd = session.cwd || project;
    if (!cwd) return;
    try {
      const path = await save({
        title: "导出 Grok 会话为 Markdown",
        defaultPath: sessionExportName(session),
        filters: [{ name: "Markdown", extensions: ["md", "markdown"] }],
      });
      if (!path) return;
      await invoke("export_grok_session", {
        sessionId: session.sessionId,
        path,
        cwd,
      });
      setStatusMessage("会话已导出");
    } catch (error) {
      addError(String(error));
    }
  };

  const deleteRemoteSession = async (session: RemoteSession) => {
    if (
      !window.confirm(
        `永久删除这个 Grok 会话？\n\n${session.title || session.sessionId}\n\n此操作会删除 Grok 保存的会话历史，无法撤销。`,
      )
    ) {
      return;
    }
    try {
      await invoke("delete_grok_session", { sessionId: session.sessionId });
      setAllSessions((current) =>
        current.filter((entry) => entry.sessionId !== session.sessionId),
      );
      setStatusMessage("Grok 会话已永久删除");
      if (connectionInfo?.sessionId === session.sessionId) {
        setItems([]);
        await startNewSession();
      }
    } catch (error) {
      addError(String(error));
    }
  };

  const answerPermission = async (optionId?: string) => {
    if (!permission) return;
    const requestId = permission.requestId;
    setPermission(undefined);
    try {
      await client.respondPermission(requestId, optionId);
    } catch (error) {
      addError(String(error));
    }
  };

  useEffect(() => {
    if (!loginOpen || loginRunning || loginSucceeded) return;
    void startLogin();
  }, [loginOpen]);

  useEffect(() => {
    if (!accountOpen) return;
    const onPointer = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest(".sidebar-account, .account-menu")) return;
      setAccountOpen(false);
    };
    document.addEventListener("mousedown", onPointer);
    return () => document.removeEventListener("mousedown", onPointer);
  }, [accountOpen]);

  const startSidebarResize = (event: ReactMouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    const origin = event.clientX;
    const start = sidebarWidth;
    const onMove = (move: MouseEvent) => {
      const next = Math.max(196, Math.min(440, start + move.clientX - origin));
      setSidebarWidth(next);
    };
    const onUp = () => {
      document.body.style.cursor = "";
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      setSidebarWidth((current) => {
        localStorage.setItem("grok-desk-sidebar-width", String(current));
        return current;
      });
    };
    document.body.style.cursor = "col-resize";
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  };

  const clampActivityWidth = useCallback((width: number, sidebar = sidebarWidth) => {
    const room = Math.max(280, window.innerWidth - sidebar - 360);
    return Math.max(280, Math.min(760, room, width));
  }, [sidebarWidth]);

  const startActivityResize = (event: ReactMouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    const origin = event.clientX;
    const start = activityWidth;
    const onMove = (move: MouseEvent) => {
      setActivityWidth(clampActivityWidth(start - (move.clientX - origin)));
    };
    const onUp = () => {
      document.body.style.cursor = "";
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      setActivityWidth((current) => {
        const next = clampActivityWidth(current);
        localStorage.setItem("grok-desk-activity-width", String(next));
        return next;
      });
    };
    document.body.style.cursor = "col-resize";
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  };

  useEffect(() => {
    const onResize = () => {
      setActivityWidth((current) => clampActivityWidth(current));
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [clampActivityWidth]);

  const openAccountOrLogin = async () => {
    if (loginOpen) {
      if (loginRunning) void cancelLogin();
      setLoginOpen(false);
      return;
    }
    if (accountOpen) {
      setAccountOpen(false);
      return;
    }
    if (connectionInfo || account?.authenticated) {
      setAccountOpen(true);
      void refreshCredits();
      return;
    }
    if (connection !== "missing") {
      try {
        const snapshot = await invoke<AccountProbe>("probe_account");
        setAccount(snapshot);
        if (snapshot.authenticated) {
          setConnection("ready");
          setStatusMessage(
            snapshot.email
              ? `已登录 ${snapshot.email}，请选择项目`
              : "账户已连接，请选择一个项目",
          );
          setAccountOpen(true);
          void refreshCredits();
          return;
        }
      } catch {
        // Fall through to the authorization dialog.
      }
    }
    setAccountOpen(false);
    setLoginOpen(true);
  };

  const startLogin = async () => {
    setLoginLogs([]);
    setDeviceAuth(undefined);
    setLoginSucceeded(false);
    setLoginRunning(true);
    try {
      await invoke("start_grok_login", { mode: "browser" });
    } catch (error) {
      setLoginRunning(false);
      setLoginLogs([String(error)]);
    }
  };

  const cancelLogin = async () => {
    try {
      await invoke("cancel_grok_login");
    } catch {
      // Best-effort; the dialog still closes locally.
    }
    setLoginRunning(false);
  };

  const logout = async () => {
    if (!window.confirm("确定要退出这台电脑上的 Grok 登录吗？")) return;
    try {
      await client.dispose();
      const result = await invoke<{ success: boolean; stderr: string }>(
        "logout_grok",
      );
      if (!result.success) throw new Error(result.stderr || "Grok logout failed");
      setConnectionInfo(undefined);
      setAccount(undefined);
      setCredits(undefined);
      setCreditsError("");
      setConnection("unauthenticated");
      setStatusMessage("已退出 Grok 登录");
      setAccountOpen(false);
      setLoginOpen(false);
    } catch (error) {
      addError(String(error));
    }
  };

  const switchModel = async (modelId: string) => {
    const model = connectionInfo?.models.find((entry) => entry.modelId === modelId);
    let effort =
      model?.reasoningEffort ??
      model?.reasoningEfforts.find((entry) => entry.isDefault)?.value ??
      model?.reasoningEfforts[0]?.value ??
      "";
    if (xhighRequiresPromise(lifePromiseRef.current, effort)) {
      effort =
        sortEfforts(model?.reasoningEfforts ?? []).reverse().find((entry) => !xhighRequiresPromise(lifePromiseRef.current, entry.value))?.value ??
        "";
    }
    const previousModel = selectedModel;
    const previousEffort = selectedEffort;
    setSelectedModel(modelId);
    setSelectedEffort(effort);
    if (!connected) return;
    setStatusMessage("正在切换模型…");
    try {
      const applied = await client.setSessionModel(modelId, effort || undefined);
      setSelectedModel(applied.modelId);
      setSelectedEffort(applied.reasoningEffort ?? "");
      setConnectionInfo((current) =>
        current
          ? {
              ...current,
              model: applied.modelId,
              models: current.models.map((entry) =>
                entry.modelId === applied.modelId
                  ? {
                      ...entry,
                      reasoningEffort: applied.reasoningEffort,
                    }
                  : entry,
              ),
            }
          : current,
      );
      setStatusMessage("模型已切换");
    } catch (error) {
      setSelectedModel(previousModel);
      setSelectedEffort(previousEffort);
      setStatusMessage("模型切换失败");
      addError(String(error));
    }
  };

  const applyEffort = async (effort: string) => {
    const previousEffort = selectedEffort;
    setSelectedEffort(effort);
    if (!connected || !selectedModel) return;
    setStatusMessage("正在应用思考强度…");
    try {
      const applied = await client.setSessionModel(selectedModel, effort);
      setSelectedEffort(applied.reasoningEffort ?? "");
      setConnectionInfo((current) =>
        current
          ? {
              ...current,
              model: applied.modelId,
              models: current.models.map((entry) =>
                entry.modelId === applied.modelId
                  ? {
                      ...entry,
                      reasoningEffort: applied.reasoningEffort,
                    }
                  : entry,
              ),
            }
          : current,
      );
      setStatusMessage("思考强度已应用");
    } catch (error) {
      setSelectedEffort(previousEffort);
      setStatusMessage("思考强度设置失败");
      addError(String(error));
    }
  };

  const switchEffort = async (effort: string) => {
    if (xhighRequiresPromise(lifePromiseRef.current, effort)) {
      pendingXhigh.current = effort;
      setLifeXhighOpen(true);
      return;
    }
    await applyEffort(effort);
  };

  const dismissLifeBroke = () => {
    persistLifePromise(markScolded(lifePromiseRef.current));
    setLifeBrokeOpen(false);
  };

  const acceptXhighPromise = () => {
    persistLifePromise(acceptLifePromise(lifePromiseRef.current));
    saveCliUnlock(null);
    setLifeXhighOpen(false);
    const pending = pendingXhigh.current;
    pendingXhigh.current = null;
    if (pending) void applyEffort(pending);
  };

  useEffect(() => {
    if (!xhighRequiresPromise(lifePromise, selectedEffort)) return;
    const model = connectionInfo?.models.find((entry) => entry.modelId === selectedModel);
    const safe = sortEfforts(model?.reasoningEfforts ?? []).reverse().find((entry) => !xhighRequiresPromise(lifePromise, entry.value));
    if (safe) void applyEffort(safe.value);
  }, [connectionInfo?.models, lifePromise, selectedEffort, selectedModel]);

  const applyPermissionMode = async (mode: PermissionModeId) => {
    setPermissionMode(mode);
    void invoke("set_setting", { key: "agent.permissionMode", value: mode }).catch(() => undefined);
    if (connection === "connected" && project) {
      await connectProject(project, {
        force: true,
        resumeSessionId: connectionInfo?.sessionId,
      });
    }
  };

  const switchMode = async (modeId: string) => {
    if (!connected) return;
    setStatusMessage("正在切换会话模式…");
    try {
      const applied = await client.setSessionMode(modeId);
      setConnectionInfo((current) =>
        current
          ? {
              ...current,
              modes: {
                currentModeId: applied.currentModeId,
                availableModes:
                  applied.availableModes.length > 0
                    ? applied.availableModes
                    : current.modes?.availableModes ?? [],
              },
            }
          : current,
      );
      setStatusMessage("会话模式已切换");
    } catch (error) {
      addError(String(error));
      setStatusMessage("会话模式切换失败");
    }
  };

  const switchConfigOption = async (
    configId: string,
    value: string | boolean,
  ) => {
    if (!connected) return;
    setStatusMessage("正在应用 Grok 配置…");
    try {
      const configOptions = await client.setSessionConfigOption(configId, value);
      setConnectionInfo((current) =>
        current
          ? {
              ...current,
              configOptions:
                configOptions.length > 0
                  ? configOptions
                  : current.configOptions.map((option) =>
                      option.id === configId
                        ? { ...option, currentValue: value }
                        : option,
                    ),
            }
          : current,
      );
      setStatusMessage("Grok 配置已应用");
    } catch (error) {
      addError(String(error));
      setStatusMessage("Grok 配置应用失败");
    }
  };

  const toolItems = items.filter((item) => item.kind === "tool").slice(-8).reverse();
  const timelineRows = useMemo(() => groupTimeline(items), [items]);
  const showConversationList = shouldShowConversationList(items);

  // 只有人本来就贴在底部时才跟着新内容走。滚上去看历史的时候把人拽回底部，
  // 是流式输出里最烦的一件事 —— 边写边看根本没法回头。
  const [stickToBottom, setStickToBottom] = useState(true);
  const NEAR_BOTTOM = 80;

  const onConversationScroll = useCallback(() => {
    const node = conversationListRef.current;
    if (!node) return;
    const distance = node.scrollHeight - node.scrollTop - node.clientHeight;
    setStickToBottom(distance <= NEAR_BOTTOM);
  }, []);

  // 输入栏那个「控制电脑」以前只是个只读标签，关掉之后连开回来的入口都没有。
  // 现在点它就能开关，走的是设置页同一条路：先落到后端，再重连当前线程。
  const toggleComputerControl = useCallback(async () => {
    const next = !computerControl;
    setComputerBusy(true);
    try {
      await invoke("set_computer_control", { enabled: next });
      setComputerControl(next);
      await invoke("set_setting", { key: "desktop.control", value: String(next) }).catch(
        () => undefined,
      );
      if (connection === "connected" && project) {
        await connectProject(project, {
          force: true,
          resumeSessionId: connectionInfo?.sessionId,
        });
      }
    } catch (error) {
      addError(String(error));
    } finally {
      setComputerBusy(false);
    }
  }, [computerControl, connection, project, connectionInfo?.sessionId, connectProject, addError]);

  const jumpToLatest = useCallback(() => {
    const node = conversationListRef.current;
    if (!node) return;
    node.scrollTo({ top: node.scrollHeight, behavior: "smooth" });
    setStickToBottom(true);
  }, []);

  useEffect(() => {
    const node = conversationListRef.current;
    if (!node || !showConversationList || !stickToBottom) return;
    node.scrollTop = node.scrollHeight;
  }, [timelineRows, busy, showConversationList, stickToBottom]);

  // 换线程时回到贴底，否则上一个线程滚到一半的状态会带过来。
  // 后台任务也一起清掉 —— 它们是挂在会话上的，跟着旧线程走。
  useEffect(() => {
    setStickToBottom(true);
    setBackgroundTasks([]);
  }, [localSessionId]);
  const connected = connection === "connected";

  // 别的线程还有几个在跑。并发之后这个数才可能大于 0。
  const backgroundThreadsRunning = runningThreadCount(
    threadSnapshots,
    connectionInfo?.sessionId ?? "",
  );

  // 「1 个命令 · 2 个子智能体」。没有在跑的就是空串，整个提示不渲染。
  const tasksRunning = runningSummary(backgroundTasks, (kind, count) =>
    t(kind === "command" ? "tasks.commandCount" : "tasks.subagentCount", { n: count }),
  );

  // 官方 CLI 自带 /compact，能把已经聊过的内容压成摘要腾出上下文。
  // 但它只在斜杠菜单里，要你自己记得。这里把它做成：平时不出现，
  // 上下文过半才冒出来，点一下直接发，不用记命令。
  const contextPercent = usage.contextSize
    ? contextUsagePercent(usage.contextUsed ?? usage.totalTokens, usage.contextSize)
    : null;
  const contextTight = (contextPercent ?? 0) >= 60;

  // 不套 useCallback：sendPrompt 本身每次渲染都是新的，包了也稳不住，
  // 而这个只用在点击回调里，稳不稳定无所谓。
  const compactContext = (note?: string) => {
    if (!connected || busy || draftConversation) return;
    void sendPrompt(note?.trim() ? `/compact ${note.trim()}` : "/compact");
  };

  const emptyKind = conversationEmptyKind({
    restoring: threadRestoring,
    connecting: connection === "connecting",
    connected,
    project,
    draft: draftConversation,
    pendingTrust,
  });
  const activeModel = connectionInfo?.models.find(
    (model) => model.modelId === selectedModel,
  );

  const paletteCommands: PaletteCommand[] = [
    { id: "new", label: t("palette.new"), detail: t("palette.newDetail"), shortcut: "Ctrl N", disabled: connection === "missing" || connection === "checking" || connection === "installing", action: () => void startNewConversation() },
    { id: "open", label: t("palette.open"), detail: t("palette.openDetail"), shortcut: "Ctrl Shift O", action: () => void chooseProject() },
    { id: "chat", label: t("palette.chat"), detail: t("palette.chatDetail"), shortcut: "Ctrl 1", action: () => setWorkspacePage("chat") },
    { id: "sessions", label: t("palette.sessions"), detail: t("palette.sessionsDetail"), shortcut: "Ctrl 2", action: () => { setWorkspacePage("sessions"); void refreshSessions(); } },
    { id: "files", label: t("palette.files"), detail: t("palette.filesDetail"), shortcut: "Ctrl 3", action: () => setWorkspacePage("files") },
    { id: "changes", label: t("palette.changes"), detail: t("palette.changesDetail"), shortcut: "Ctrl 4", action: () => setWorkspacePage("changes") },
    ...CHECK_ACTIONS.map((action) => ({
      id: `check-${action.id}`,
      label: t(`check.${action.id}.label`),
      detail: t(`check.${action.id}.detail`),
      disabled: !connected || draftConversation || busy,
      action: () => runCheck(action.id),
    })),
    { id: "terminal", label: t("palette.terminal"), detail: t("palette.terminalDetail"), shortcut: "Ctrl 5", action: () => setWorkspacePage("terminal") },
    { id: "settings", label: t("palette.settings"), detail: t("palette.settingsDetail"), shortcut: "Ctrl ,", action: () => { if (!lifeSealed) setWorkspacePage("settings"); } },
    { id: "extensions", label: t("palette.extensions"), detail: t("palette.extensionsDetail"), action: () => setWorkspacePage("extensions") },
    { id: "focus", label: t("palette.focus"), detail: t("palette.focusDetail"), shortcut: "Ctrl L", disabled: !connected, action: () => { setWorkspacePage("chat"); window.setTimeout(() => composerRef.current?.focus(), 0); } },
    { id: "preview", label: t("palette.preview"), detail: t("palette.previewDetail"), shortcut: "Ctrl P", action: () => { setActivityOpen(true); setSidebarTab("preview"); } },
    { id: "compact", label: t("palette.compact"), detail: t("palette.compactDetail"), disabled: !connected || busy, action: () => compactContext() },
    { id: "context", label: t("palette.context"), detail: t("palette.contextDetail"), disabled: !connected || busy, action: () => { void sendPrompt("/context"); } },
    { id: "account", label: t("palette.account"), detail: connectionInfo || account?.authenticated ? friendlyTier(connectionInfo?.subscriptionTier ?? account?.subscriptionTier) : t("palette.loginGrok"), action: () => void openAccountOrLogin() },
    ...availableCommands.map((command) => ({
      id: `grok-command-${command.name}`,
      label: `/${command.name}`,
      detail: command.description || "Grok 命令",
      disabled: !connected,
      action: () => {
        setWorkspacePage("chat");
        setInput(`/${command.name}${command.hint ? " " : ""}`);
        window.setTimeout(() => composerRef.current?.focus(), 0);
      },
    })),
  ];

  const slashCommands = input.startsWith("/")
    ? availableCommands
        .filter((command) =>
          command.name
            .toLowerCase()
            .startsWith(input.slice(1).split(/\s/, 1)[0].toLowerCase()),
        )
        .slice(0, 7)
    : [];

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey)) {
        if (event.key === "Escape") {
          if (paletteOpen) {
            setPaletteOpen(false);
            return;
          }
          if (workspacePage !== "chat") {
            event.preventDefault();
            setWorkspacePage("chat");
          }
        }
        return;
      }
      const key = event.key.toLowerCase();
      if (key === "k") {
        event.preventDefault();
        setPaletteOpen((value) => !value);
      } else if (key === "n") {
        event.preventDefault();
        void startNewConversation();
      } else if (key === "o" && event.shiftKey) {
        event.preventDefault();
        void chooseProject();
      } else if (key === ",") {
        event.preventDefault();
        if (!lifeSealed) setWorkspacePage("settings");
      } else if (key === "l" && connected) {
        event.preventDefault();
        setWorkspacePage("chat");
        window.setTimeout(() => composerRef.current?.focus(), 0);
      } else if (key === "p") {
        event.preventDefault();
        setActivityOpen(true);
        setSidebarTab("preview");
      } else if (["1", "2", "3", "4", "5"].includes(key)) {
        event.preventDefault();
        const pages: WorkspacePage[] = ["chat", "sessions", "files", "changes", "terminal"];
        setWorkspacePage(pages[Number(key) - 1]);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

  const showingWelcome =
    workspacePage === "chat" &&
    items.length === 0 &&
    !connected &&
    !draftConversation &&
    connection !== "connecting";
  const showingComposer = workspacePage === "chat" && !showingWelcome;
  const activityVisible = activityOpen && connected && workspacePage === "chat";

  return (
    <div
      className={`app-shell ${sidebarOpen ? "" : "sidebar-collapsed"} ${activityVisible ? "stage-split" : ""}`}
      style={{
        ["--sidebar-width" as string]: `${sidebarWidth}px`,
        ["--activity-width" as string]: `${activityWidth}px`,
      }}
    >
      <Sidebar
        project={project}
        currentSessionId={connectionInfo?.sessionId}
        folders={groupSessionsByFolder(allSessions, recentProjects, project)}
        expanded={expandedFolders}
        query={sidebarQuery}
        disabled={connection === "missing" || connection === "checking" || connection === "installing"}
        onQuery={setSidebarQuery}
        onToggleFolder={toggleFolder}
        onNewThread={() => void startNewConversation()}
        onNewInFolder={(path) => void startThreadInFolder(path)}
        onOpenThread={(session) => void openThreadFromTree(session)}
        onRenameThread={(session, title) => void renameRemoteSession(session, title)}
        onCollapse={() => setSidebarOpen(false)}
        threadState={(sessionId) => threadBadge(threadSnapshots[sessionId])}
        onStopThread={(sessionId) => void cancelThread(sessionId)}
        onDeleteThread={(session) => void deleteThread(session)}
      >
        <div className="sidebar-resizer" onMouseDown={startSidebarResize} title={t("sidebar.resize")} />
        <div className="sidebar-account">
          <button
            className="sidebar-footer"
            onClick={() => void openAccountOrLogin()}
          >
            <div className="account-avatar">{(connectionInfo?.email ?? account?.email)?.[0]?.toUpperCase() ?? "G"}</div>
            <div>
              <strong>{connectionInfo?.email ?? account?.email ?? t("common.account")}</strong>
              <span>
                {credits
                  ? t("sidebar.remaining", { period: periodLabel(credits.periodType), n: Math.round(credits.remainingPercent) })
                  : creditsLoading
                    ? t("status.readingCredits")
                    : connectionInfo || account?.authenticated
                      ? friendlyTier(connectionInfo?.subscriptionTier ?? account?.subscriptionTier)
                      : t("common.login")}
              </span>
            </div>
          </button>
        </div>
      </Sidebar>

      {!sidebarOpen && (
        <button className="sidebar-open icon-button" onClick={() => setSidebarOpen(true)} title={t("sidebar.expand")}>
          <PanelLeftOpen size={18} />
        </button>
      )}

      <div className="stage">
        <div className="workspace-chrome">
          <div className="chrome-drag" data-tauri-drag-region>
            {project && !draftConversation ? (
              <button className="project-pill" onClick={chooseProject}>
                <Folder size={14} />
                <span>{shortPath(project)}</span>
                <ChevronDown size={13} />
              </button>
            ) : (
              <span className="chrome-status">{statusMessage}</span>
            )}
          </div>
          <div className="chrome-actions">
            <button className="icon-button" onClick={() => setPaletteOpen(true)} title={t("common.search")} aria-label={t("common.search")}>
              <Search size={16} />
            </button>
            <button
              className={`icon-button ${goMode ? "on" : ""}`}
              onClick={() => persistGoMode(!goMode)}
              title={goMode ? t("go.off") : t("go.on")}
              aria-pressed={goMode}
              aria-label={goMode ? t("go.off") : t("go.on")}
            >
              <Bug size={16} />
            </button>
            <button className="icon-button" onClick={() => { setActivityOpen(true); setSidebarTab("preview"); }} title={t("activity.preview")}>
              <Eye size={16} />
            </button>
            {lifeConfig.enabled ? (
              <button
                className={`life-chip ${lifeLock.locked ? "locked" : ""}`}
                onClick={() => {
                  if (lifeSealed) return;
                  setWorkspacePage("settings");
                }}
                title={lifeSealed ? t("life.lock.sealed") : t("life.mode")}
              >
                {t("life.chip", { used: Math.round(lifeLock.usedToday), budget: lifeLock.budget })}
              </button>
            ) : null}
            <WindowControls />
          </div>
        </div>
      <main className={showingComposer ? "workspace workspace-chat" : "workspace"}>
        {workspacePage === "extensions" ? (
          <Suspense fallback={<div className="page-loading"><LoaderCircle className="spin" size={18} />{t("load.extensions")}</div>}>
            <ExtensionsPage project={project} onError={addError} onClose={() => setWorkspacePage("chat")} />
          </Suspense>
        ) : workspacePage === "settings" ? (
          <Suspense fallback={<div className="page-loading"><LoaderCircle className="spin" size={18} />{t("load.settings")}</div>}>
            <SettingsPanel
              theme={theme}
              models={connectionInfo?.models ?? []}
              selectedModel={selectedModel}
              selectedEffort={selectedEffort}
              modes={connectionInfo?.modes}
              configOptions={connectionInfo?.configOptions ?? []}
              saveHistory={saveHistory}
              goMode={goMode}
              permissionMode={permissionMode}
              onTheme={setTheme}
              onModel={(modelId) => void switchModel(modelId)}
              onEffort={(effort) => void switchEffort(effort)}
              onMode={(modeId) => void switchMode(modeId)}
              onConfig={(configId, value) =>
                void switchConfigOption(configId, value)
              }
              onSaveHistory={setSaveHistory}
              onGoMode={persistGoMode}
              onPermissionMode={(mode) => void applyPermissionMode(mode)}
              onError={addError}
              onOpenTool={(page) => setWorkspacePage(page)}
              onComputerControl={(enabled) => {
                setComputerControl(enabled);
                if (connection === "connected" && project) {
                  void connectProject(project, {
                    force: true,
                    resumeSessionId: connectionInfo?.sessionId,
                  });
                }
              }}
              lifeMode={lifeConfig}
              lifeUsedToday={lifeLock.usedToday}
              lifeBudget={lifeLock.budget}
              onLifeMode={requestLifeMode}
              lifeSealed={lifeSealed}
              lifeFormReset={lifeFormReset}
              onPreviewLifeLock={lifeSealed ? undefined : (reason) => {
                if (reason === "broke") {
                  setLifeBrokeDemo("scold");
                  return;
                }
                if (reason === "xhigh") {
                  setLifeBrokeDemo("xhigh");
                  return;
                }
                setLifeDemo(reason);
                setWorkspacePage("chat");
              }}
              onClose={() => setWorkspacePage("chat")}
            />
          </Suspense>
        ) : workspacePage === "terminal" ? (
          <Suspense fallback={<div className="page-loading"><LoaderCircle className="spin" size={18} />{t("load.terminal")}</div>}>
            <TerminalPanel project={project} onError={addError} onClose={() => setWorkspacePage("chat")} />
          </Suspense>
        ) : workspacePage === "manage" ? (
          <Suspense fallback={<div className="page-loading"><LoaderCircle className="spin" size={18} />{t("load.manage")}</div>}>
            <CommandCenter project={project} onError={addError} onClose={() => setWorkspacePage("chat")} />
          </Suspense>
        ) : workspacePage === "files" ? (
          <Suspense fallback={<div className="page-loading"><LoaderCircle className="spin" size={18} />{t("load.files")}</div>}>
            <FilesPanel project={project} onError={addError} onClose={() => setWorkspacePage("chat")} />
          </Suspense>
        ) : workspacePage === "changes" ? (
          <Suspense fallback={<div className="page-loading"><LoaderCircle className="spin" size={18} />{t("load.diff")}</div>}>
            <ChangesPanel
              project={project}
              onError={addError}
              reviewDisabled={!connected || draftConversation || busy}
              onReview={() => runCheck("local")}
              onClose={() => setWorkspacePage("chat")}
            />
          </Suspense>
        ) : workspacePage === "sessions" ? (
          <SessionsPage
            sessions={allSessions}
            loading={sessionsLoading}
            supported
            onRefresh={() => void refreshSessions()}
            onOpen={(session) => void openRemoteSession(session)}
            onRename={(session) => void renameRemoteSession(session)}
            onExport={(session) => void exportRemoteSession(session)}
            onDelete={(session) => void deleteRemoteSession(session)}
            deleteSupported
            onClose={() => setWorkspacePage("chat")}
          />
        ) : showingWelcome ? (
          <div className="welcome">
            <h1>{t("welcome.title")}</h1>
            <p className="welcome-copy">
              {account?.authenticated
                ? t("welcome.signedIn", { email: account.email ? ` ${account.email}` : "" })
                : t("welcome.intro")}
            </p>
            {connection === "installing" ? (
              <div className="setup-card">
                <LoaderCircle className="spin" size={20} />
                <div>
                  <strong>{t("welcome.preparing")}</strong>
                  <span>
                    {statusMessage}
                    {typeof bootstrapPercent === "number" ? ` (${bootstrapPercent}%)` : ""}
                    {t("welcome.preparingHint")}
                  </span>
                </div>
              </div>
            ) : connection === "missing" ? (
              <div className="setup-card error-card">
                <AlertCircle size={20} />
                <div>
                  <strong>{t("welcome.missing")}</strong>
                  <span>{statusMessage || t("welcome.missingHint")}</span>
                </div>
                <button
                  className="secondary-action compact"
                  onClick={() => {
                    setConnection("installing");
                    void invoke<GrokStatus>("ensure_runtime")
                      .then((result) => {
                        if (result.available) window.location.reload();
                        else setStatusMessage(result.error || "安装仍失败");
                      })
                      .catch((error) => setStatusMessage(String(error)));
                  }}
                >
                  {t("welcome.retryInstall")}
                </button>
              </div>
            ) : connection === "unauthenticated" ? (
              <div className="setup-card error-card">
                <LogIn size={20} />
                <div><strong>{t("welcome.needLogin")}</strong><span>{t("welcome.needLoginHint")}</span></div>
              </div>
            ) : connection === "subscription-required" ? (
              <div className="setup-card error-card">
                <BadgeCheck size={20} />
                <div><strong>{t("welcome.noBuild")}</strong><span>{t("welcome.noBuildHint")}</span></div>
              </div>
            ) : connection === "incompatible" ? (
              <div className="setup-card error-card">
                <AlertCircle size={20} />
                <div><strong>{t("welcome.protocol")}</strong><span>{statusMessage}</span></div>
              </div>
            ) : connection === "disconnected" ? (
              <div className="setup-card error-card">
                <RefreshCw size={20} />
                <div><strong>{t("welcome.disconnected")}</strong><span>{t("welcome.disconnectedHint")}</span></div>
              </div>
            ) : connection === "error" && project ? (
              <div className="setup-card error-card">
                <AlertCircle size={20} />
                <div><strong>{t("welcome.failed")}</strong><span>{statusMessage}</span></div>
              </div>
            ) : null}
            <div className="welcome-actions">
              <button className="primary-action" onClick={project ? () => connectProject(project) : chooseProject} disabled={connection === "checking" || connection === "installing"}>
                <FolderOpen size={17} />
                {project ? t("welcome.reconnect") : t("welcome.chooseProject")}
              </button>
              <button className="secondary-action" onClick={() => void openAccountOrLogin()}>
                <LogIn size={16} /> {account?.authenticated ? t("welcome.viewAccount") : t("welcome.connectAccount")}
              </button>
            </div>
            {!project && (
              <div className="path-entry">
                <span>{t("welcome.orPaste")}</span>
                <div>
                  <input
                    value={manualProject}
                    onChange={(event) => setManualProject(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" && manualProject.trim()) {
                        void connectProject(manualProject.trim());
                      }
                    }}
                    placeholder="C:\\path\\to\\project"
                    aria-label={t("welcome.projectPath")}
                    spellCheck={false}
                  />
                  <button
                    onClick={() => void connectProject(manualProject.trim())}
                    disabled={!manualProject.trim()}
                  >
                    {t("common.open")}
                  </button>
                </div>
              </div>
            )}
            <div className="feature-row">
              <span><ShieldAlert size={14} /> {t("welcome.feature.approvals")}</span>
              <span><GitBranch size={14} /> {t("welcome.feature.git")}</span>
              <span><TerminalSquare size={14} /> {t("welcome.feature.local")}</span>
            </div>
          </div>
        ) : (
          <>
            <div className="conversation">
              {!showConversationList ? (
                <div className="conversation-empty">
                  <div className="empty-mark"><Sparkles size={23} /></div>
                  {emptyKind === "trust" ? (
                    <>
                      <h2>{t("trust.title")}</h2>
                      <p>{t("trust.body")}</p>
                      <p className="folder-path">{pendingTrust}</p>
                      <div className="welcome-actions">
                        <button
                          className="primary-action"
                          onClick={() => void connectProject(pendingTrust, { force: true, assumeTrusted: true })}
                        >
                          {t("trust.confirm")}
                        </button>
                        <button
                          className="secondary-action"
                          onClick={() => {
                            setPendingTrust("");
                            setStatusMessage(t("common.cancel"));
                          }}
                        >
                          {t("common.cancel")}
                        </button>
                      </div>
                    </>
                  ) : emptyKind === "connecting" ? (
                    <>
                      <h2>{t("chat.connecting")}</h2>
                      <p>{t("chat.connectingBody", { path: shortPath(project) })}</p>
                    </>
                  ) : emptyKind === "restoring" ? (
                    <>
                      <h2>{t("chat.reading")}</h2>
                      <p>{t("chat.readingBody")}</p>
                    </>
                  ) : emptyKind === "pick-folder" ? (
                    <>
                      <h2>{t("chat.start")}</h2>
                      <p>{t("chat.startNew")}</p>
                      <FolderSetupCard
                        recents={recentProjects}
                        current={project}
                        connecting={connection === "connecting"}
                        path={manualProject}
                        onPath={setManualProject}
                        onBrowse={() => void browseFolder()}
                        onPick={(path) => void bindConversationFolder(path)}
                      />
                    </>
                  ) : (
                    <>
                      <h2>{t("chat.start")}</h2>
                      <p>{t("chat.connectedTo", { path: shortPath(project) })}</p>
                      <div className="quick-grid">
                        {QUICK_PROMPTS.map(({ icon: Icon, labelKey, prompt }) => (
                          <button key={labelKey} onClick={() => sendPrompt(prompt)}>
                            <Icon size={17} /><span>{t(labelKey)}</span><ChevronRight size={14} />
                          </button>
                        ))}
                      </div>
                    </>
                  )}
                </div>
              ) : (
                <div className="message-scroll-list" ref={conversationListRef} onScroll={onConversationScroll} role="log" aria-live="polite">
                  <div className="virtual-message-header" />
                  {timelineRows.map((row) => (
                    <div className="virtual-message-row" key={row.id}>
                      {row.type === "tools" ? (
                        <ToolGroupCard items={row.items} project={project} />
                      ) : (
                        <TimelineCard item={row.item} project={project} />
                      )}
                    </div>
                  ))}
                  <div className="virtual-message-footer">
                    {busy && (
                      <div className="thinking-row"><LoaderCircle className="spin" size={15} /><span>{t("chat.thinking")}</span></div>
                    )}
                  </div>
                  {!stickToBottom && (
                    <button className="jump-latest" onClick={jumpToLatest} title={t("chat.jumpLatest")}>
                      <ChevronDown size={14} />
                      <span>{t("chat.jumpLatest")}</span>
                    </button>
                  )}
                </div>
              )}
              {goMode && (
                <aside className="go-debug-panel" aria-label={t("go.title")}>
                  <header>
                    <strong>{t("go.title")}</strong>
                    <span>{debugLines.length ? t("go.lines", { n: debugLines.length }) : t("go.waiting")}</span>
                    <button type="button" onClick={() => persistGoMode(false)}>{t("common.close")}</button>
                  </header>
                  <pre>{(debugLines.length ? debugLines : logs).slice(-40).join("\n") || t("go.empty")}</pre>
                </aside>
              )}
            </div>

            <div className="composer-wrap">
              <div className="composer" onPaste={(event) => void pasteClipboard(event)}>
                {slashCommands.length > 0 && !input.includes(" ") && (
                  <div className="slash-menu" role="listbox" aria-label="Grok 命令">
                    {slashCommands.map((command) => (
                      <button
                        key={command.name}
                        role="option"
                        onClick={() => {
                          setInput(`/${command.name}${command.hint ? " " : ""}`);
                          composerRef.current?.focus();
                        }}
                      >
                        <strong>/{command.name}</strong>
                        <span>{command.description}</span>
                        {command.hint && <small>{command.hint}</small>}
                      </button>
                    ))}
                  </div>
                )}
                {attachments.length > 0 && (
                  <div className="attach-list">
                    {attachments.map((file) => (
                      <span key={file.storedPath} className="attach-chip">
                        {file.dataUrl ? <img src={file.dataUrl} alt="" /> : <Paperclip size={12} />}
                        <em>{file.name}</em>
                        <button
                          type="button"
                          aria-label={`移除 ${file.name}`}
                          onClick={() =>
                            setAttachments((current) =>
                              current.filter((entry) => entry.storedPath !== file.storedPath),
                            )
                          }
                        >
                          <X size={12} />
                        </button>
                      </span>
                    ))}
                  </div>
                )}
                <textarea
                  ref={composerRef}
                  value={input}
                  onChange={(event) => setInput(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && !event.shiftKey) {
                      event.preventDefault();
                      void sendPrompt();
                    }
                  }}
                  placeholder={
                    emptyKind === "connecting"
                      ? t("composer.connecting")
                      : emptyKind === "trust"
                        ? t("composer.trust")
                      : connected && !draftConversation
                      ? t("composer.placeholder")
                      : t("composer.pickFolder")
                  }
                  rows={1}
                  disabled={!connected || draftConversation || Boolean(pendingTrust)}
                />
                <div className="composer-bottom">
                  <div className="model-controls">
                    <ComposerPlus
                      disabled={busy || (!project && !userHome)}
                      connectorCount={connectors.filter((item) => item.enabled).length}
                      onAddFiles={() => void pickAttachments()}
                      onAddFolder={() => void pickAttachmentFolder()}
                      onScreenshot={() => void captureDesktop()}
                      onCheck={runCheck}
                      onOpenExtensions={() => setWorkspacePage("extensions")}
                    />
                    <label>
                      <Bot size={14} />
                      <select
                        aria-label={t("composer.model")}
                        value={selectedModel}
                        disabled={busy || !connectionInfo?.models.length}
                        onChange={(event) => void switchModel(event.target.value)}
                      >
                        {(connectionInfo?.models ?? []).map((model) => (
                          <option key={model.modelId} value={model.modelId}>
                            {model.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      <ShieldAlert size={14} />
                      <select
                        aria-label={t("composer.permission")}
                        value={permissionMode}
                        disabled={busy}
                        onChange={(event) => void applyPermissionMode(event.target.value as PermissionModeId)}
                      >
                        {PERMISSION_MODES.map((mode) => (
                          <option key={mode.id} value={mode.id}>
                            {t(`perm.${mode.id}.label`)}
                          </option>
                        ))}
                      </select>
                    </label>
                    <button
                      type="button"
                      className={`computer-chip${computerControl ? " on" : ""}`}
                      disabled={computerBusy}
                      aria-pressed={computerControl}
                      title={computerControl ? t("composer.computerOff") : t("composer.computerOn")}
                      onClick={() => void toggleComputerControl()}
                    >
                      <MousePointer2 size={13} />
                      {t("composer.computer")}
                    </button>
                    {connected && !draftConversation ? (
                      <span
                        className="token-chip"
                        title={t("composer.tokensTitle", {
                          total: spend.total,
                          in: spend.input,
                          out: spend.output,
                        })}
                      >
                        {formatTokens(spend.total)} {t("composer.tokens")}
                        {contextPercent != null ? (
                          <em className={contextTight ? "tight" : ""}>
                            {t("composer.contextPct", { n: contextPercent })}
                          </em>
                        ) : null}
                      </span>
                    ) : null}
                    {goalAutoRunning ? (
                      <button
                        type="button"
                        className="goal-chip"
                        title={t("goal.chipTitle")}
                        onClick={() => {
                          goalActiveRef.current = false;
                          setGoalAutoRunning(false);
                          setStatusMessage(t("goal.stopped"));
                        }}
                      >
                        <Sparkles size={13} />
                        {t("goal.chip", { n: goalRoundsRef.current })}
                      </button>
                    ) : null}
                    {backgroundThreadsRunning > 0 ? (
                      <span className="threads-chip" title={t("composer.threadsRunningTitle")}>
                        <LoaderCircle size={13} className="spin" />
                        {t("composer.threadsRunning", { n: backgroundThreadsRunning })}
                      </span>
                    ) : null}
                    {tasksRunning ? (
                      <button
                        type="button"
                        className="tasks-chip"
                        title={t("tasks.openPanel")}
                        onClick={() => { setActivityOpen(true); setSidebarTab("activity"); }}
                      >
                        <LoaderCircle size={13} className="spin" />
                        {tasksRunning}
                      </button>
                    ) : null}
                    {connected && !draftConversation && contextTight ? (
                      <button
                        type="button"
                        className="compact-chip"
                        disabled={busy}
                        title={t("composer.compactTitle", { n: contextPercent ?? 0 })}
                        onClick={() => compactContext()}
                      >
                        <Minimize2 size={13} />
                        {t("composer.compact")}
                      </button>
                    ) : null}
                    {activeModel?.supportsReasoningEffort &&
                    activeModel.reasoningEfforts.length > 0 ? (
                      <EffortSlider
                        efforts={activeModel.reasoningEfforts}
                        value={selectedEffort}
                        disabled={busy}
                        onChange={(effort) => void switchEffort(effort)}
                      />
                    ) : null}
                  </div>
                  {busy ? (
                    <>
                      {input.trim() ? (
                        <button
                          className="send-button interject"
                          title={t("composer.interject")}
                          aria-label={t("composer.interject")}
                          onClick={() => sendPrompt()}
                        >
                          <Send size={17} />
                        </button>
                      ) : null}
                      <button className="stop-button" onClick={cancelPrompt}><CircleStop size={17} /></button>
                    </>
                  ) : (
                    <button className="send-button" onClick={() => sendPrompt()} disabled={draftConversation || (!input.trim() && attachments.length === 0)}><Send size={17} /></button>
                  )}
                </div>
              </div>
              <span className="composer-hint">
                {draftConversation
                  ? t("composer.needFolder")
                  : computerControl
                    ? t("composer.hintComputer")
                    : t("composer.hint")}
              </span>
            </div>
          </>
        )}
      </main>

      {activityVisible && (
        <aside className={`activity-panel ${sidebarTab === "preview" ? "previewing" : ""}`}>
          <div className="activity-resizer" onMouseDown={startActivityResize} title={t("activity.resize")} />
          <div className="activity-head">
            <div className="sidebar-tabs" role="tablist">
              <button className={sidebarTab === "activity" ? "on" : ""} onClick={() => setSidebarTab("activity")}>{t("activity.title")}</button>
              <button className={sidebarTab === "preview" ? "on" : ""} onClick={() => setSidebarTab("preview")}>{t("activity.preview")}</button>
            </div>
            <button className="icon-button" onClick={() => setActivityOpen(false)} aria-label={t("activity.close")}><X size={15} /></button>
          </div>
          {sidebarTab === "preview" ? (
            <PreviewPanel
              url={previewUrl}
              draft={previewDraft}
              nonce={previewEpoch}
              onDraft={setPreviewDraft}
              onOpen={(value) => {
                if (!isSafePreviewUrl(value)) {
                  addError("预览只支持 http://localhost 或 127.0.0.1");
                  return;
                }
                setPreviewUrl(value);
              }}
              onRefresh={() => setPreviewEpoch((value) => value + 1)}
              onExternal={(value) => {
                void invoke("open_preview_url", { url: value }).catch((error) => addError(String(error)));
              }}
              // 退出预览回到活动页，而不是把整个活动面板关掉 —— 面板顶上那个 X
              // 关的是面板，正盯着预览内容的人不会把它当成「退出预览」。
              onExit={() => setSidebarTab("activity")}
            />
          ) : (
            <>
              <section className="session-stats">
                <div><span>{t("activity.model")}</span><strong>{connectionInfo?.model ?? "—"}</strong></div>
                <div><span>{t("activity.tokens")}</span><strong>{formatTokens(spend.total)}</strong></div>
                <div><span>{t("activity.context")}</span><strong>{usage.contextSize ? `${contextUsagePercent(usage.contextUsed ?? usage.totalTokens, usage.contextSize) ?? 0}%` : "—"}</strong></div>
                <div><span>{t("activity.status")}</span><strong className={busy ? "working" : "idle"}>{busy ? t("status.working") : t("status.idle")}</strong></div>
              </section>
              {backgroundTasks.length > 0 && (
                <section className="activity-list task-list">
                  <label>{t("tasks.title")}</label>
                  {backgroundTasks.map((task) => (
                    <div className={`activity-item task-${task.status}`} key={task.id}>
                      <div className="tool-dot">
                        {task.kind === "subagent" ? <Bot size={13} /> : <TerminalSquare size={13} />}
                      </div>
                      <div>
                        <strong title={task.title}>{task.title || task.id.slice(0, 8)}</strong>
                        <span>
                          {task.kind === "subagent" && task.subagentType ? `${task.subagentType} · ` : ""}
                          {task.status === "running"
                            ? task.progress || t("tasks.running")
                            : task.status === "failed"
                              ? t("tasks.failed", { code: task.exitCode ?? "?" })
                              : t("tasks.done")}
                          {task.durationSecs ? ` · ${Math.round(task.durationSecs)}s` : ""}
                        </span>
                      </div>
                      {task.status === "running" ? (
                        <button
                          className="task-stop"
                          title={t("tasks.stopTitle")}
                          aria-label={t("tasks.stop")}
                          onClick={() => void stopBackgroundTask(task)}
                        >
                          <Square size={10} />
                        </button>
                      ) : null}
                      {task.status === "running"
                        ? <LoaderCircle size={13} className="spin" />
                        : task.status === "failed"
                          ? <ShieldAlert size={14} className="danger" />
                          : <Check size={14} className="success" />}
                    </div>
                  ))}
                </section>
              )}
              <section className="activity-list">
                <label>{t("activity.tools")}</label>
                {toolItems.length ? toolItems.map((item) => (
                  <div className="activity-item" key={item.id}>
                    <div className="tool-dot"><Wrench size={13} /></div>
                    <div><strong>{item.title}</strong><span>{item.text || (item.status === "completed" ? t("activity.done") : item.status || t("activity.running"))}</span></div>
                    {item.status === "completed" ? <Check size={14} className="success" /> : <LoaderCircle size={13} className="spin" />}
                  </div>
                )) : <p className="no-activity">{t("activity.none")}</p>}
              </section>
              {logs.length > 0 && (
                <details className="log-panel"><summary>{t("activity.logs")} · {logs.length}</summary><pre>{logs.slice(-20).join("\n")}</pre></details>
              )}
              <div className="activity-footer"><span>{grokVersion || connectionInfo?.agentVersion}</span><span>ACP v1</span></div>
            </>
          )}
        </aside>
      )}
      </div>

      {(lifeSealed || lifeDemo) && !(lifeDemo && workspacePage === "settings") ? (
        <LifeLockScreen
          lock={lifeLock}
          demo={Boolean(lifeDemo)}
          sealed={!lifeDemo && lifeSealed}
          onEndDemo={() => setLifeDemo(null)}
        />
      ) : null}
      {lifeConfirm ? (
        <LifeConfirmDialog
          request={lifeConfirm}
          onAccept={acceptLifeConfirm}
          onCancel={cancelLifeConfirm}
        />
      ) : null}
      {lifeBrokeDemo ? (
        <LifeBrokeDialog
          kind={lifeBrokeDemo}
          onAccept={() => setLifeBrokeDemo(null)}
          onCancel={() => setLifeBrokeDemo(null)}
        />
      ) : null}
      {lifeBrokeOpen && !lifeBrokeDemo ? <LifeBrokeDialog kind="scold" onAccept={dismissLifeBroke} /> : null}
      {lifeXhighOpen && !lifeBrokeDemo ? (
        <LifeBrokeDialog
          kind="xhigh"
          onAccept={acceptXhighPromise}
          onCancel={() => {
            pendingXhigh.current = null;
            setLifeXhighOpen(false);
          }}
        />
      ) : null}

      {permission && (
        <PermissionDialog request={permission} onAnswer={answerPermission} />
      )}
      {paletteOpen && (
        <CommandPalette
          commands={paletteCommands}
          query={paletteQuery}
          onQuery={setPaletteQuery}
          onClose={() => { setPaletteOpen(false); setPaletteQuery(""); }}
        />
      )}
      {accountOpen && (connectionInfo || account?.authenticated) && (
        <AccountMenu
          email={connectionInfo?.email ?? account?.email}
          tier={connectionInfo?.subscriptionTier ?? account?.subscriptionTier}
          teamName={connectionInfo?.teamName ?? account?.teamName}
          project={project}
          connected={connected}
          usage={usage}
          contextSize={activeModel?.totalContextTokens}
          sessionId={connectionInfo?.sessionId}
          credits={credits}
          creditsLoading={creditsLoading}
          creditsError={creditsError}
          onRefreshCredits={() => void refreshCredits()}
          onManageBilling={() => {
            void invoke("open_external_url", { url: OFFICIAL_BILLING_URL }).catch((error) =>
              addError(String(error)),
            );
          }}
          onRedeemUsageReset={() => {
            void (async () => {
              try {
                if ((credits?.resetAvailableCount ?? 0) > 0) {
                  const next = await invoke<AccountCredits>("redeem_usage_reset", {
                    tokenId: credits?.resetTokenId ?? null,
                  });
                  setCredits(next);
                  setStatusMessage("用量已重置");
                  return;
                }
                await invoke("open_external_url", { url: OFFICIAL_USAGE_URL });
              } catch (error) {
                try {
                  await invoke("open_external_url", { url: OFFICIAL_USAGE_URL });
                } catch {
                  addError(String(error));
                }
              }
            })();
          }}
          onSettings={() => { setAccountOpen(false); if (!lifeSealed) setWorkspacePage("settings"); }}
          onExtensions={() => { setAccountOpen(false); setWorkspacePage("extensions"); }}
          onSessions={() => { setAccountOpen(false); setWorkspacePage("sessions"); void refreshSessions(); }}
          onFiles={() => { setAccountOpen(false); setWorkspacePage("files"); }}
          onChanges={() => { setAccountOpen(false); setWorkspacePage("changes"); }}
          onManage={() => { setAccountOpen(false); setWorkspacePage("manage"); }}
          onTerminal={() => { setAccountOpen(false); setWorkspacePage("terminal"); }}
          onSwitchFolder={() => { setAccountOpen(false); void chooseProject(); }}
          onReconnect={() => { setAccountOpen(false); if (project) void connectProject(project, { force: true }); }}
          onLogout={() => void logout()}
          onClose={() => setAccountOpen(false)}
        />
      )}
      {loginOpen && (
        <LoginDialog
          running={loginRunning}
          succeeded={loginSucceeded}
          device={deviceAuth}
          error={!loginRunning && !loginSucceeded ? loginLogs.at(-1) : undefined}
          // 失败时把 CLI 的原始输出一并交给弹窗。只给最后一行的话，
          // 用户看到的永远是自己那句「请检查上方输出」，而那个输出并不存在。
          logs={loginLogs}
          onCancel={() => void cancelLogin()}
          onOpenUrl={(url) =>
            void invoke("open_external_url", { url }).catch((error) =>
              setLoginLogs((current) => [...current, String(error)]),
            )
          }
          onClose={() => {
            if (loginRunning) void cancelLogin();
            setLoginOpen(false);
          }}
        />
      )}
    </div>
  );
}

function CommandPalette({
  commands,
  query,
  onQuery,
  onClose,
}: {
  commands: PaletteCommand[];
  query: string;
  onQuery: (value: string) => void;
  onClose: () => void;
}) {
  const t = useT();
  const normalized = query.trim().toLowerCase();
  const visible = commands.filter((command) =>
    `${command.label} ${command.detail}`.toLowerCase().includes(normalized),
  );
  const run = (command: PaletteCommand) => {
    if (command.disabled) return;
    onClose();
    command.action();
  };
  return (
    <div className="modal-backdrop command-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div className="command-palette" role="dialog" aria-modal="true" aria-label={t("palette.title")}>
        <div className="command-search"><Search size={17} /><input autoFocus value={query} onChange={(event) => onQuery(event.target.value)} onKeyDown={(event) => { if (event.key === "Escape") onClose(); if (event.key === "Enter" && visible[0]) run(visible[0]); }} placeholder={t("palette.search")} /></div>
        <div className="command-list">
          {visible.map((command) => (
            <button key={command.id} disabled={command.disabled} onClick={() => run(command)}>
              <div><strong>{command.label}</strong><span>{command.detail}</span></div>
              {command.shortcut && <kbd>{command.shortcut}</kbd>}
            </button>
          ))}
          {visible.length === 0 && <p>{t("palette.empty")}</p>}
        </div>
        <footer><span>{t("palette.enter")}</span><span>{t("palette.esc")}</span></footer>
      </div>
    </div>
  );
}

function SessionsPage({
  sessions,
  loading,
  supported,
  deleteSupported,
  onRefresh,
  onOpen,
  onRename,
  onExport,
  onDelete,
  onClose,
}: {
  sessions: RemoteSession[];
  loading: boolean;
  supported: boolean;
  deleteSupported: boolean;
  onRefresh: () => void;
  onOpen: (session: RemoteSession) => void;
  onRename: (session: RemoteSession) => void;
  onExport: (session: RemoteSession) => void;
  onDelete: (session: RemoteSession) => void;
  onClose?: () => void;
}) {
  const t = useT();
  const [query, setQuery] = useState("");
  const normalized = query.trim().toLowerCase();
  const visible = sessions.filter((session) =>
    `${session.title ?? ""} ${session.sessionId} ${session.cwd ?? ""}`
      .toLowerCase()
      .includes(normalized),
  );
  return (
    <section className="sessions-page">
      <header className="page-toolbar">
        <div><span className="page-icon"><History size={17} /></span><div><strong>{t("page.sessions")}</strong><small>{t("page.sessionsHint")}</small></div></div>
        <div className="session-toolbar-actions">
          <label><Search size={13} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("sessions.search")} aria-label={t("sessions.search")} /></label>
          <button className="secondary-action compact" onClick={onRefresh} disabled={loading || !supported}>
            <RefreshCw className={loading ? "spin" : ""} size={14} />{t("common.refresh")}
          </button>
          {onClose ? (
            <button type="button" className="page-close" onClick={onClose}>
              <X size={14} /> {t("common.close")}
            </button>
          ) : null}
        </div>
      </header>
      {!supported ? (
        <div className="empty-page"><AlertCircle size={22} /><h3>{t("sessions.openProject")}</h3><p>{t("sessions.openProjectHint")}</p></div>
      ) : loading && sessions.length === 0 ? (
        <div className="page-loading"><LoaderCircle className="spin" size={18} />{t("sessions.loading")}</div>
      ) : sessions.length === 0 ? (
        <div className="empty-page"><History size={22} /><h3>{t("sessions.empty")}</h3><p>{t("sessions.emptyHint")}</p></div>
      ) : visible.length === 0 ? (
        <div className="empty-page"><Search size={22} /><h3>{t("sessions.noMatch")}</h3><p>{t("sessions.noMatchHint")}</p></div>
      ) : (
        <div className="sessions-list">
          {visible.map((session, index) => (
            <article key={session.sessionId} className="session-row">
              <button className="session-main" onClick={() => onOpen(session)}>
                <span className="session-index">{String(index + 1).padStart(2, "0")}</span>
                <div><strong>{session.title || session.summary || `Grok task ${session.sessionId.slice(0, 8)}`}</strong><span>{session.cwd || t("sessions.unknownCwd")}{session.numChatMessages ? ` · ${t("sessions.messages", { n: session.numChatMessages })}` : ""}</span></div>
                <time>{session.updatedAt ? new Date(session.updatedAt).toLocaleString() : t("sessions.restorable")}</time>
                <ChevronRight size={15} />
              </button>
              <div className="session-actions">
                <button onClick={() => onRename(session)} title="在本地重命名" aria-label={`重命名 ${session.title ?? session.sessionId}`}><Pencil size={13} /></button>
                <button onClick={() => onExport(session)} title="导出 Markdown" aria-label={`导出 ${session.title ?? session.sessionId}`}><FileDown size={13} /></button>
                <button className="danger" disabled={!deleteSupported} onClick={() => onDelete(session)} title="用 grok sessions delete 永久删除" aria-label={`删除 ${session.title ?? session.sessionId}`}><Trash2 size={13} /></button>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

function CollapsedCode({ text }: { text: string }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const lines = text.replace(/\n$/, "").split("\n");
  const long = lines.length > 8 || text.length > 400;
  if (!long) {
    return <pre><code>{text}</code></pre>;
  }
  return (
    <div className="code-fold">
      <button type="button" onClick={() => setOpen((value) => !value)}>
        {open ? t("code.collapse") : t("code.expand", { n: lines.length })}
      </button>
      <pre><code>{open ? text : `${lines.slice(0, 4).join("\n")}\n…`}</code></pre>
    </div>
  );
}

function markdownCode(props: { children?: ReactNode }) {
  const child = Array.isArray(props.children) ? props.children[0] : props.children;
  if (child && typeof child === "object" && "props" in child) {
    const text = String((child as { props?: { children?: unknown } }).props?.children ?? "");
    return <CollapsedCode text={text} />;
  }
  return <pre>{props.children}</pre>;
}

function conversationImageSrc(src: string, project?: string) {
  if (isInlineImageSrc(src) || /^https?:\/\//i.test(src)) return src;
  const absolute = localImageAbsolutePath(src, project);
  if (!absolute) return "";
  try {
    return convertFileSrc(absolute);
  } catch {
    return "";
  }
}

function ConversationImages({
  images,
  project,
}: {
  images?: TimelineImage[];
  project?: string;
}) {
  if (!images?.length) return null;
  const visible = images
    .map((image) => ({ ...image, href: conversationImageSrc(image.src, project) }))
    .filter((image) => image.href);
  if (!visible.length) return null;
  return (
    <div className="message-images">
      {visible.map((image, index) => (
        <a key={`${image.href}-${index}`} href={image.href} target="_blank" rel="noreferrer">
          <img src={image.href} alt={image.alt || "图片"} />
        </a>
      ))}
    </div>
  );
}

function TimelineCard({ item, project }: { item: TimelineItem; project?: string }) {
  const t = useT();
  if (item.kind === "user") {
    // goal 驱动器注入的内部指令：不是用户说的话，折叠成一行，免得
    // 大段英文提示词冒充「你」出现在对话里。想看的点开。
    if (item.harness) {
      return (
        <details className="harness-item">
          <summary>{t("timeline.harnessPrompt")}</summary>
          <pre>{item.text}</pre>
        </details>
      );
    }
    const reminders = item.reminders?.length ? (
      <details className="harness-item">
        <summary>{t("timeline.systemNotice", { n: item.reminders.length })}</summary>
        <pre>{item.reminders.join("\n\n———\n\n")}</pre>
      </details>
    ) : null;
    // 整条消息只有系统通知（后台任务跑完那种）：不摆「你」的气泡，
    // 那不是人说的话。
    if (!item.text.trim() && !item.images?.length) return reminders;
    return (
      <>
        <div className="message user-message">
          <div className="message-label">{t("you")}</div>
          <ConversationImages images={item.images} project={project} />
          {item.text ? <p>{item.text}</p> : null}
        </div>
        {reminders}
      </>
    );
  }
  if (item.kind === "assistant") {
    return (
      <div className="message assistant-message">
        <div className="assistant-avatar"><img className="brand-mark tiny" src={brandIcon} alt="" /></div>
        <div>
          <div className="message-label">Grok</div>
          <ConversationImages images={item.images} project={project} />
          <div className="markdown-body">
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              components={{
                pre: markdownCode,
                img: ({ src, alt }) => {
                  const href = conversationImageSrc(String(src ?? ""), project);
                  return href ? <img src={href} alt={alt || "图片"} /> : null;
                },
              }}
            >
              {item.text}
            </ReactMarkdown>
          </div>
        </div>
      </div>
    );
  }
  if (item.kind === "thought") {
    return <details className="thought-card"><summary><Sparkles size={14} /> {t("thought")}</summary><p>{item.text}</p></details>;
  }
  if (item.kind === "tool") {
    return <ToolGroupCard items={[item]} project={project} />;
  }
  if (item.kind === "error") {
    return <div className="inline-error"><AlertCircle size={16} /><span>{item.text}</span></div>;
  }
  if (!item.text) {
    return <div className="status-card compact"><strong>{item.title}</strong></div>;
  }
  return (
    <details className="status-card">
      <summary><strong>{item.title}</strong></summary>
      <p>{item.text}</p>
    </details>
  );
}

function ToolGroupCard({ items, project }: { items: TimelineItem[]; project?: string }) {
  const t = useT();
  const [expanded, setExpanded] = useState(false);
  const images = items.flatMap((item) => item.images ?? []);
  const running = items.some((item) => item.status !== "completed" && item.status !== "failed");
  const label = items.length === 1
    ? `${items[0].title}${items[0].text ? ` · ${items[0].text}` : ""}`
    : `${items.length} ${t("activity.tools")}${running ? t("activity.running") : t("activity.done")}`;
  return (
    <div className="tool-card">
      <ConversationImages images={images} project={project} />
      <button onClick={() => setExpanded((value) => !value)}>
        <span className="tool-card-icon"><Wrench size={14} /></span>
        <span><strong>{label}</strong><small>{running ? t("activity.running") : t("activity.done")}</small></span>
        {running ? <LoaderCircle size={14} className="spin" /> : <Check size={14} className="success" />}
        {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
      </button>
      {expanded && (
        <ul className="tool-lines">
          {items.map((item) => (
            <li key={item.toolCallId ?? item.id}>
              <strong>{item.title}</strong>
              <span>{item.text || item.status || ""}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function PermissionDialog({ request, onAnswer }: { request: PermissionRequest; onAnswer: (optionId?: string) => void }) {
  const t = useT();
  const tool = request.toolCall;
  const title = String(tool.title ?? tool.kind ?? t("activity.running"));
  const detail = tool.rawInput ?? tool.content ?? tool;
  const options = request.options.length ? request.options : [{ optionId: "", name: t("common.cancel"), kind: "reject_once" }];
  return (
    <div className="modal-backdrop">
      <div className="permission-dialog" role="dialog" aria-modal="true">
        <div className="permission-icon"><ShieldAlert size={22} /></div>
        <div className="permission-copy">
          <p className="eyebrow">{t("perm.need")}</p>
          <h3>{title}</h3>
          <p>{t("perm.body")}</p>
        </div>
        <p className="permission-summary">{summarizePermission(detail)}</p>
        <div className="permission-actions">
          {options.map((option) => (
            <button
              key={option.optionId || option.name}
              className={permissionIsAllow(option) ? "approve" : "deny"}
              onClick={() => onAnswer(option.optionId || undefined)}
            >
              {permissionIsAllow(option) ? <Play size={15} /> : <X size={15} />}
              {permissionLabel(option)}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

export default App;
