import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import {
  BookOpen,
  Bug,
  Check,
  FolderOpen,
  FolderPlus,
  GitBranch,
  HardDrive,
  History,
  LoaderCircle,
  LogOut,
  Mail,
  Network,
  Plug,
  Plus,
  ExternalLink,
  RefreshCw,
  Settings,
  Sparkles,
  TerminalSquare,
  Wrench,
  X,
} from "lucide-react";
import {
  contextUsagePercent,
  sourceLabel,
  type ExtensionSnapshot,
  type McpServerInfo,
  type SkillInfo,
} from "./extensions";
import type { UsageInfo } from "./sessionUpdates";
import { CATALOG_CONNECTORS, OFFICIAL_CONNECTORS_URL } from "./connectors";
import { t, useT } from "./i18n";

export const OFFICIAL_BILLING_URL = "https://grok.com/?_s=billing";
export const OFFICIAL_USAGE_URL = "https://grok.com/?_s=usage";

interface AccountProbe {
  authenticated: boolean;
  email?: string;
  subscriptionTier?: string;
  authMode?: string;
  teamName?: string;
}

interface DeviceAuth {
  url: string;
  code: string;
}

export interface AccountCredits {
  usedPercent: number;
  remainingPercent: number;
  periodType: string;
  periodStart?: string;
  periodEnd?: string;
  products: Array<{ product: string; usagePercent: number }>;
  prepaidDollars?: number;
  onDemandUsed?: number;
  onDemandCap?: number;
  subscriptionTier?: string;
  resetAvailableCount?: number;
  resetTokenId?: string;
  resetExpiresAt?: string;
}

export function periodLabel(type?: string) {
  if (type?.includes("MONTH")) return t("period.month");
  return t("period.week");
}

function formatReset(iso?: string) {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString();
}

function productLabel(name: string) {
  return name.replace(/^Grok/, "Grok ");
}

export function LoginDialog({
  running,
  succeeded,
  device,
  error,
  onCancel,
  onOpenUrl,
  onClose,
}: {
  running: boolean;
  succeeded: boolean;
  device?: DeviceAuth;
  error?: string;
  onCancel: () => void;
  onOpenUrl: (url: string) => void;
  onClose: () => void;
}) {
  const t = useT();
  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <div
        className="auth-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="auth-title"
        onClick={(event) => event.stopPropagation()}
      >
        <button className="icon-button auth-close" onClick={onClose} aria-label={t("common.close")}>
          <X size={16} />
        </button>
        <div className="auth-mark"><Sparkles size={18} /></div>
        <h2 id="auth-title">{t("login.title")}</h2>
        <p>{t("login.body")}</p>
        {succeeded ? (
          <div className="auth-status ok"><Check size={16} /> {t("login.done")}</div>
        ) : (
          <div className="auth-status">
            <LoaderCircle className="spin" size={16} />
            {device ? t("login.confirm") : running ? t("login.opening") : t("login.preparing")}
          </div>
        )}
        {device && (
          <div className="auth-code">
            <span>{t("login.code")}</span>
            <strong>{device.code}</strong>
            <button className="primary-action" onClick={() => onOpenUrl(device.url)}>
              {t("login.openBrowser")}
            </button>
          </div>
        )}
        {error && <p className="auth-error">{error}</p>}
        <div className="auth-actions">
          {running && !succeeded && (
            <button className="secondary-action" onClick={onCancel}>{t("common.cancel")}</button>
          )}
        </div>
      </div>
    </div>
  );
}

export function AccountMenu({
  email,
  tier,
  teamName,
  project,
  connected,
  usage,
  contextSize,
  sessionId,
  credits,
  creditsLoading,
  creditsError,
  onRefreshCredits,
  onManageBilling,
  onRedeemUsageReset,
  onSettings,
  onExtensions,
  onSessions,
  onFiles,
  onChanges,
  onManage,
  onTerminal,
  onSwitchFolder,
  onReconnect,
  onLogout,
  onClose,
}: {
  email?: string;
  tier?: string;
  teamName?: string;
  project?: string;
  connected: boolean;
  usage: UsageInfo;
  contextSize?: number;
  sessionId?: string;
  credits?: AccountCredits;
  creditsLoading?: boolean;
  creditsError?: string;
  onRefreshCredits: () => void;
  onManageBilling: () => void;
  onRedeemUsageReset: () => void;
  onSettings: () => void;
  onExtensions: () => void;
  onSessions: () => void;
  onFiles: () => void;
  onChanges: () => void;
  onManage: () => void;
  onTerminal: () => void;
  onSwitchFolder: () => void;
  onReconnect: () => void;
  onLogout: () => void;
  onClose: () => void;
}) {
  const [mcpCount, setMcpCount] = useState(0);
  const [skillCount, setSkillCount] = useState(0);
  const [cliUsage, setCliUsage] = useState<{ used?: number; size?: number; percent?: number }>({});
  useEffect(() => {
    void invoke<ExtensionSnapshot>("list_extensions", { cwd: project || null })
      .then((snapshot) => {
        setMcpCount(snapshot.mcpServers.length);
        setSkillCount(snapshot.skills.length);
      })
      .catch(() => undefined);
  }, [project]);
  useEffect(() => {
    if (!sessionId) return;
    void invoke<{
      contextTokensUsed?: number;
      contextWindowTokens?: number;
      contextWindowUsage?: number;
    }>("grok_session_usage", { sessionId })
      .then((snapshot) => {
        setCliUsage({
          used: snapshot.contextTokensUsed,
          size: snapshot.contextWindowTokens,
          percent: snapshot.contextWindowUsage,
        });
      })
      .catch(() => undefined);
  }, [sessionId]);
  const used = cliUsage.used ?? usage.contextUsed ?? usage.totalTokens;
  const size = cliUsage.size || usage.contextSize || contextSize;
  const percent = cliUsage.percent ?? contextUsagePercent(used, size);
  const t = useT();
  const folder = project ? project.replaceAll("\\", "/").split("/").filter(Boolean).at(-1) : "";

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="account-menu" role="dialog" aria-label={t("account.menu")}>
      <div className="account-menu-id">
        <div className="account-avatar">{email?.[0]?.toUpperCase() ?? "G"}</div>
        <div>
          <strong>{email ?? t("account.signedIn")}</strong>
          <span>{[friendlyTier(tier), teamName].filter(Boolean).join(" · ") || t("account.grok")}</span>
        </div>
      </div>

      <section className="account-section">
        <label>{t("account.quota")}</label>
        <div className="usage-card">
          <div className="usage-row">
            <span>{t("account.plan")}</span>
            <strong>{friendlyTier(credits?.subscriptionTier ?? tier)}</strong>
          </div>
          {creditsLoading && !credits ? (
            <div className="usage-row muted"><LoaderCircle className="spin" size={14} /><span>{t("account.readingQuota")}</span></div>
          ) : credits ? (
            <>
              <div className="usage-hero">
                <span>{t("account.remaining", { period: periodLabel(credits.periodType) })}</span>
                <strong>{Math.round(credits.remainingPercent)}%</strong>
              </div>
              <div className="usage-meter" aria-label={t("account.remainingAria", { period: periodLabel(credits.periodType), n: Math.round(credits.remainingPercent) })}>
                <i style={{ width: `${Math.max(0, Math.min(100, credits.remainingPercent))}%` }} />
              </div>
              <div className="usage-row muted">
                <span>{t("account.used")}</span>
                <span>{Math.round(credits.usedPercent)}%</span>
              </div>
              {credits.products.map((item) => (
                <div className="usage-row muted" key={item.product}>
                  <span>{productLabel(item.product)}</span>
                  <span>{Math.round(item.usagePercent)}%</span>
                </div>
              ))}
              {credits.periodEnd && (
                <div className="usage-row muted">
                  <span>{t("account.nextReset")}</span>
                  <span>{formatReset(credits.periodEnd)}</span>
                </div>
              )}
              {(credits.resetAvailableCount ?? 0) > 0 && (
                <div className="usage-row muted">
                  <span>{t("account.resetTokens")}</span>
                  <span>
                    {t("account.resetLeft", { n: credits.resetAvailableCount ?? 0 })}
                    {credits.resetExpiresAt ? ` · ${t("account.resetBefore", { date: formatReset(credits.resetExpiresAt) })}` : ""}
                  </span>
                </div>
              )}
              {credits.prepaidDollars !== undefined && (
                <div className="usage-row muted">
                  <span>{t("account.prepaid")}</span>
                  <span>${credits.prepaidDollars.toFixed(2)}</span>
                </div>
              )}
            </>
          ) : (
            <p className="usage-note">{creditsError || t("account.quotaUnavailable")}</p>
          )}
          {size ? (
            <div className="usage-row muted">
              <span>{t("account.sessionContext")}</span>
              <span>{percent ?? 0}% · {formatTokens(used)} / {formatTokens(size)}</span>
            </div>
          ) : null}
          <div className="account-credit-actions">
            <button className="account-link" onClick={onRedeemUsageReset} disabled={creditsLoading}>
              {t("account.resetUsage")}
            </button>
            <button className="account-link" onClick={onRefreshCredits} disabled={creditsLoading}>
              {creditsLoading ? t("account.refreshing") : t("account.refreshQuota")}
            </button>
            <button className="account-link" onClick={onManageBilling}>
              <ExternalLink size={13} />
              {t("account.billing")}
            </button>
          </div>
          <p className="usage-note">{t("account.resetNote")}</p>
        </div>
      </section>

      <button className="account-menu-item" onClick={onSettings}>
        <Settings size={15} /> {t("account.settings")}
      </button>
      <button className="account-menu-item" onClick={onExtensions}>
        <Sparkles size={15} /> {t("account.extensions")}
        <em>{mcpCount} MCP · {skillCount} Skills</em>
      </button>

      <section className="account-section">
        <label>{t("account.workspace")}</label>
        <button className="account-menu-item compact" onClick={onSessions}>
          <History size={15} /> {t("settings.sessions")}
        </button>
        <button className="account-menu-item compact" onClick={onFiles}>
          <FolderOpen size={15} /> {t("settings.files")}
        </button>
        <button className="account-menu-item compact" onClick={onChanges}>
          <GitBranch size={15} /> {t("settings.changes")}
        </button>
        <button className="account-menu-item compact" onClick={onManage}>
          <Wrench size={15} /> {t("settings.manage")}
        </button>
        <button className="account-menu-item compact" onClick={onTerminal}>
          <TerminalSquare size={15} /> {t("settings.terminal")}
        </button>
      </section>

      <section className="account-section">
        <label>{t("account.connection")}</label>
        <div className="connect-card">
          <div className="usage-row">
            <span>{t("account.project")}</span>
            <strong title={project}>{folder || t("account.none")}</strong>
          </div>
          <div className="usage-row muted">
            <span>{t("account.status")}</span>
            <span>{connected ? t("account.connected") : t("account.disconnected")}</span>
          </div>
          <button className="account-menu-item compact" onClick={onSwitchFolder}>
            <FolderOpen size={15} /> {t("account.switchFolder")}
          </button>
          <button className="account-menu-item compact" onClick={onReconnect} disabled={!project}>
            <RefreshCw size={15} /> {t("account.reconnect")}
          </button>
        </div>
      </section>

      <button className="account-menu-item danger" onClick={onLogout}>
        <LogOut size={15} /> {t("account.logout")}
      </button>
    </div>
  );
}

const CONNECTOR_ICONS = {
  gmail: Mail,
  "google-drive": HardDrive,
  github: GitBranch,
  linear: Sparkles,
  notion: BookOpen,
  sentry: Bug,
} as const;

export function ExtensionsPage({
  project,
  onError,
  onClose,
}: {
  project: string;
  onError: (message: string) => void;
  onClose?: () => void;
}) {
  const [snapshot, setSnapshot] = useState<ExtensionSnapshot>();
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [transport, setTransport] = useState<"stdio" | "http">("http");
  const [target, setTarget] = useState("");
  const [busyName, setBusyName] = useState("");
  const t = useT();

  const refresh = async () => {
    setLoading(true);
    try {
      const next = await invoke<ExtensionSnapshot>("list_extensions", {
        cwd: project || null,
      });
      setSnapshot(next);
    } catch (error) {
      onError(String(error));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
  }, [project]);

  const mutate = async (
    action: string,
    server: Partial<McpServerInfo> & { name: string; commandOrUrl?: string; args?: string[] },
  ) => {
    setBusyName(server.name);
    try {
      await invoke("manage_mcp", {
        request: {
          action,
          name: server.name,
          transport: server.transport,
          commandOrUrl: server.commandOrUrl ?? server.target,
          args: server.args ?? [],
          scope: "user",
          cwd: project || null,
        },
      });
      await refresh();
      setAdding(false);
      setName("");
      setTarget("");
    } catch (error) {
      onError(String(error));
    } finally {
      setBusyName("");
    }
  };

  const importSkill = async () => {
    try {
      const selected = await open({ directory: true, title: "选择包含 SKILL.md 的文件夹" });
      if (typeof selected !== "string") return;
      await invoke<SkillInfo>("import_skill", { sourceDir: selected });
      await refresh();
    } catch (error) {
      onError(String(error));
    }
  };

  return (
    <section className="extensions-page">
      <header className="page-toolbar">
        <div>
          <span className="page-icon"><Plug size={17} /></span>
          <div>
            <strong>{t("page.connectors")}</strong>
            <small>{t("page.connectorsHint")}</small>
          </div>
        </div>
        <div className="page-toolbar-actions">
          <button className="secondary-action compact" onClick={() => void refresh()} disabled={loading}>
            <RefreshCw size={14} /> {t("common.refresh")}
          </button>
          {onClose ? (
            <button type="button" className="page-close" onClick={onClose}>
              <X size={14} /> {t("common.close")}
            </button>
          ) : null}
        </div>
      </header>

      {loading && !snapshot ? (
        <div className="page-loading"><LoaderCircle className="spin" size={18} />{t("ext.loading")}</div>
      ) : (
        <div className="extensions-body">
          <section>
            <div className="extensions-head">
              <div>
                <h3>{t("ext.official")}</h3>
                <p>{t("ext.officialHint")}</p>
              </div>
              <button
                className="secondary-action compact"
                onClick={() => void invoke("open_external_url", { url: OFFICIAL_CONNECTORS_URL })}
              >
                <ExternalLink size={14} /> {t("ext.openGrok")}
              </button>
            </div>
            <div className="connector-grid">
              {CATALOG_CONNECTORS.map((item) => {
                const linked = (snapshot?.mcpServers ?? []).some(
                  (server) => server.name === item.id || server.target === item.url,
                );
                const Icon = CONNECTOR_ICONS[item.id as keyof typeof CONNECTOR_ICONS] ?? Plug;
                return (
                  <article key={item.id} className={`connector-card ${item.kind}`}>
                    <header>
                      <span className="ext-icon"><Icon size={16} /></span>
                      <div>
                        <strong>{t(`connector.${item.id}.name`)}</strong>
                        <em>{item.kind === "official-web" ? "grok.com" : "HTTP MCP"}</em>
                      </div>
                    </header>
                    <p>{linked ? t("connector.linked") : t(`connector.${item.id}.detail`)}</p>
                    <div className="ext-actions">
                      <button
                        disabled={busyName === item.id}
                        onClick={() => {
                          if (item.kind === "official-web") {
                            void invoke("open_external_url", { url: item.url }).catch((error) => onError(String(error)));
                            return;
                          }
                          void mutate("add", { name: item.id, transport: "http", commandOrUrl: item.url });
                        }}
                      >
                        {item.kind === "official-web" ? t("ext.authorize") : linked ? t("ext.saved") : t("ext.connect")}
                      </button>
                    </div>
                  </article>
                );
              })}
            </div>
          </section>
          <section>
            <div className="extensions-head">
              <div>
                <h3>{t("ext.mcp")}</h3>
                <p>{t("ext.mcpHint")}</p>
              </div>
              <button className="secondary-action compact" onClick={() => setAdding((value) => !value)}>
                <Plus size={14} /> {t("ext.addMcp")}
              </button>
            </div>
            {adding && (
              <form
                className="mcp-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  if (!name.trim() || !target.trim()) return;
                  void mutate("add", { name: name.trim(), transport, commandOrUrl: target.trim() });
                }}
              >
                <label>{t("ext.name")}<input value={name} onChange={(event) => setName(event.target.value)} placeholder="github" required /></label>
                <label>{t("ext.transport")}
                  <select value={transport} onChange={(event) => setTransport(event.target.value as "stdio" | "http")}>
                    <option value="http">HTTP</option>
                    <option value="stdio">{t("ext.stdio")}</option>
                  </select>
                </label>
                <label className="wide">{transport === "http" ? t("ext.url") : t("ext.command")}
                  <input
                    value={target}
                    onChange={(event) => setTarget(event.target.value)}
                    placeholder={transport === "http" ? "https://mcp.example.com/mcp" : "npx"}
                    required
                  />
                </label>
                <div className="mcp-form-actions">
                  <button type="button" className="secondary-action compact" onClick={() => setAdding(false)}>{t("common.cancel")}</button>
                  <button type="submit" className="primary-action compact" disabled={!!busyName}>{t("ext.saveGrok")}</button>
                </div>
              </form>
            )}
            <div className="ext-list">
              {(snapshot?.mcpServers ?? []).length === 0 && <p className="ext-empty">{t("ext.mcpEmpty")}</p>}
              {(snapshot?.mcpServers ?? []).map((server) => (
                <article key={`${server.sourceType}-${server.name}`} className="ext-card">
                  <span className="ext-icon"><Network size={15} /></span>
                  <div>
                    <strong>{server.name}</strong>
                    <small>{server.transport} · {sourceLabel(server.sourceType)} · {server.target || t("ext.noTarget")}</small>
                  </div>
                  <div className="ext-actions">
                    {server.managed ? (
                      <>
                        <button disabled={busyName === server.name} onClick={() => void mutate(server.enabled ? "disable" : "enable", server)}>
                          {server.enabled ? t("ext.disable") : t("ext.enable")}
                        </button>
                        <button className="danger" disabled={busyName === server.name} onClick={() => void mutate("remove", server)}>{t("ext.delete")}</button>
                      </>
                    ) : (
                      <button disabled={busyName === server.name} onClick={() => void mutate("add", server)}>{t("ext.saveGrok")}</button>
                    )}
                  </div>
                </article>
              ))}
            </div>
          </section>

          <section>
            <div className="extensions-head">
              <div>
                <h3>{t("ext.skills")}</h3>
                <p>{t("ext.skillsHint")}</p>
              </div>
              <div className="extensions-head-actions">
                <button className="secondary-action compact" onClick={() => void invoke("open_skills_home")}>
                  <FolderOpen size={14} /> {t("ext.openDir")}
                </button>
                <button className="secondary-action compact" onClick={() => void importSkill()}>
                  <FolderPlus size={14} /> {t("ext.importSkill")}
                </button>
              </div>
            </div>
            <div className="ext-list">
              {(snapshot?.skills ?? []).length === 0 && <p className="ext-empty">{t("ext.skillsEmpty")}</p>}
              {(snapshot?.skills ?? []).map((skill) => (
                <article key={`${skill.sourceType}-${skill.path || skill.name}`} className="ext-card">
                  <span className="ext-icon"><Sparkles size={15} /></span>
                  <div>
                    <strong>/{skill.name}</strong>
                    <small>{sourceLabel(skill.sourceType)}{skill.userInvocable ? ` · ${t("ext.slash")}` : ""} · {skill.description || skill.path}</small>
                  </div>
                </article>
              ))}
            </div>
          </section>
        </div>
      )}
    </section>
  );
}

function friendlyTier(tier?: string) {
  if (!tier) return t("account.signedIn");
  return tier
    .replace(/^x_premium$/i, "X Premium")
    .replace(/^supergrok$/i, "SuperGrok")
    .replaceAll("_", " ");
}

function formatTokens(value?: number) {
  if (!value) return "0";
  return value > 999 ? `${(value / 1000).toFixed(1)}k` : String(value);
}

export type { AccountProbe, DeviceAuth };
