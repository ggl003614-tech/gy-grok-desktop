import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
import {
  BellRing,
  Bot,
  Check,
  Eye,
  FileDown,
  FolderOpen,
  GitBranch,
  History,
  Monitor,
  Moon,
  MousePointer2,
  Settings,
  ShieldCheck,
  Sun,
  TerminalSquare,
  Wrench,
  X,
} from "lucide-react";
import type {
  GrokModel,
  SessionConfigOption,
  SessionModeState,
} from "./acpClient";
import { PERMISSION_MODES, type PermissionModeId } from "./permissionModes";
import { EffortSlider } from "./EffortSlider";
import { useLocale } from "./i18n";
import { LifeModeSettings, LifeModeTitle } from "./LifeModeSettings";
import type { LifeModeConfig, LifePreviewKind } from "./lifeMode";

export type ThemeMode = "system" | "dark" | "light";

interface SettingsPanelProps {
  theme: ThemeMode;
  models: GrokModel[];
  selectedModel: string;
  selectedEffort: string;
  modes?: SessionModeState;
  configOptions: SessionConfigOption[];
  saveHistory: boolean;
  goMode: boolean;
  permissionMode: PermissionModeId;
  onTheme: (theme: ThemeMode) => void;
  onModel: (modelId: string) => void;
  onEffort: (effort: string) => void;
  onMode: (modeId: string) => void;
  onConfig: (configId: string, value: string | boolean) => void;
  onSaveHistory: (value: boolean) => void;
  onGoMode: (value: boolean) => void;
  onPermissionMode: (mode: PermissionModeId) => void;
  onError: (message: string) => void;
  onOpenTool?: (page: "sessions" | "files" | "changes" | "manage" | "terminal") => void;
  onComputerControl?: (enabled: boolean) => void;
  onClose?: () => void;
  lifeMode: LifeModeConfig;
  lifeUsedToday?: number;
  lifeBudget?: number;
  onLifeMode: (next: LifeModeConfig) => boolean | void;
  lifeSealed?: boolean;
  onPreviewLifeLock?: (reason: LifePreviewKind) => void;
  lifeFormReset?: number;
}

type StoredSettings = Record<string, unknown>;

async function saveSetting(key: string, value: unknown) {
  await invoke("set_setting", { key, value });
}

export function SettingsPanel({
  theme,
  models,
  selectedModel,
  selectedEffort,
  modes,
  configOptions,
  saveHistory,
  goMode,
  permissionMode,
  onTheme,
  onModel,
  onEffort,
  onMode,
  onConfig,
  onSaveHistory,
  onGoMode,
  onPermissionMode,
  onError,
  onOpenTool,
  onComputerControl,
  onClose,
  lifeMode,
  lifeUsedToday,
  lifeBudget,
  onLifeMode,
  lifeSealed,
  onPreviewLifeLock,
  lifeFormReset,
}: SettingsPanelProps) {
  const [telemetry, setTelemetry] = useState(false);
  const [updateChannel, setUpdateChannel] = useState("stable");
  const [computerControl, setComputerControl] = useState(true);
  const [captureDetail, setCaptureDetail] = useState("low");
  const [computerBusy, setComputerBusy] = useState(false);
  const [saved, setSaved] = useState("");
  const { locale, setLocale, t } = useLocale();
  const activeModel = models.find((model) => model.modelId === selectedModel);
  const extraConfig = configOptions.filter(
    (option) => !/model|reason/i.test(`${option.id} ${option.name}`),
  );

  useEffect(() => {
    void invoke<StoredSettings>("get_settings")
      .then((settings) => {
        if (typeof settings["privacy.telemetry"] === "boolean") {
          setTelemetry(settings["privacy.telemetry"] as boolean);
        }
        if (typeof settings["updates.channel"] === "string") {
          setUpdateChannel(settings["updates.channel"] as string);
        }
        if (typeof settings["desktop.control"] === "boolean") {
          setComputerControl(settings["desktop.control"] as boolean);
        }
        if (settings["desktop.captureDetail"] === "high" || settings["desktop.captureDetail"] === "low") {
          setCaptureDetail(settings["desktop.captureDetail"] as string);
        }
        if (settings["appearance.locale"] === "en" || settings["appearance.locale"] === "zh") {
          setLocale(settings["appearance.locale"]);
        }
      })
      .catch((error) => onError(String(error)));
    void invoke<{ enabled: boolean; detail?: string }>("computer_control_status")
      .then((status) => {
        setComputerControl(status.enabled);
        if (status.detail === "high" || status.detail === "low") setCaptureDetail(status.detail);
      })
      .catch(() => undefined);
  }, [onError]);

  const persist = async (key: string, value: unknown, label: string) => {
    try {
      await saveSetting(key, value);
      setSaved(label);
      window.setTimeout(() => setSaved(""), 1800);
    } catch (error) {
      onError(String(error));
    }
  };

  const exportDiagnostics = async () => {
    try {
      const path = await save({
        title: "导出 GY Grok 诊断",
        defaultPath: "grok-desk-diagnostics.json",
        filters: [{ name: "JSON", extensions: ["json"] }],
      });
      if (!path) return;
      await invoke("export_diagnostics", { path });
      setSaved("诊断已导出");
    } catch (error) {
      onError(String(error));
    }
  };

  return (
    <section className="settings-page">
      <header className="page-toolbar">
        <div>
          <span className="page-icon"><Settings size={17} /></span>
          <div><strong>{t("settings.title")}</strong><small>{t("settings.subtitle")}</small></div>
        </div>
        <div className="page-toolbar-actions">
          <span className="settings-saved" aria-live="polite">{saved && <><Check size={13} />{saved}</>}</span>
          {onClose ? (
            <button type="button" className="page-close" onClick={onClose}>
              <X size={14} /> {t("common.close")}
            </button>
          ) : null}
        </div>
      </header>

      <div className="settings-content">
        <section className="settings-section">
          <LifeModeTitle />
          <LifeModeSettings
            config={lifeMode}
            usedToday={lifeUsedToday}
            budget={lifeBudget}
            sealed={lifeSealed}
            resetToken={lifeFormReset}
            onChange={(next) => {
              if (lifeSealed) return;
              const applied = onLifeMode(next);
              if (applied !== false) void persist("life.mode", next, t("saved.life"));
            }}
            onPreview={lifeSealed ? undefined : onPreviewLifeLock}
          />
        </section>
        {onOpenTool && (
          <section className="settings-section">
            <div className="settings-section-title"><Wrench size={16} /><div><strong>{t("settings.workspace")}</strong><span>{t("settings.workspaceHint")}</span></div></div>
            <div className="settings-tools">
              <button onClick={() => onOpenTool("sessions")}><History size={15} />{t("settings.sessions")}</button>
              <button onClick={() => onOpenTool("files")}><FolderOpen size={15} />{t("settings.files")}</button>
              <button onClick={() => onOpenTool("changes")}><GitBranch size={15} />{t("settings.changes")}</button>
              <button onClick={() => onOpenTool("manage")}><Wrench size={15} />{t("settings.manage")}</button>
              <button onClick={() => onOpenTool("terminal")}><TerminalSquare size={15} />{t("settings.terminal")}</button>
            </div>
          </section>
        )}
        <section className="settings-section">
          <div className="settings-section-title"><Eye size={16} /><div><strong>{t("settings.appearance")}</strong><span>{t("settings.appearanceHint")}</span></div></div>
          <div className="theme-grid" role="radiogroup" aria-label={t("settings.theme")}>
            {([
              ["system", "settings.theme.system", Monitor],
              ["dark", "settings.theme.dark", Moon],
              ["light", "settings.theme.light", Sun],
            ] as const).map(([id, label, Icon]) => (
              <button
                key={id}
                className={theme === id ? "selected" : ""}
                role="radio"
                aria-checked={theme === id}
                onClick={() => {
                  onTheme(id);
                  void persist("appearance.theme", id, t("saved.theme"));
                }}
              >
                <Icon size={18} /><span>{t(label)}</span>{theme === id && <Check size={14} />}
              </button>
            ))}
          </div>
          <div className="settings-section-title" style={{ marginTop: 18 }}><div><strong>{t("lang.label")}</strong><span>{t("lang.hint")}</span></div></div>
          <div className="theme-grid" role="radiogroup" aria-label={t("lang.label")}>
            {(["zh", "en"] as const).map((id) => (
              <button
                key={id}
                className={locale === id ? "selected" : ""}
                role="radio"
                aria-checked={locale === id}
                onClick={() => {
                  setLocale(id);
                  void persist("appearance.locale", id, t("saved.locale"));
                }}
              >
                <span>{t(id === "zh" ? "lang.zh" : "lang.en")}</span>{locale === id && <Check size={14} />}
              </button>
            ))}
          </div>
        </section>

        <section className="settings-section">
          <div className="settings-section-title"><Bot size={16} /><div><strong>{t("settings.models")}</strong><span>{t("settings.modelsHint")}</span></div></div>
          {models.length ? (
            <div className="settings-fields">
              <label><span>{t("settings.currentModel")}</span><select value={selectedModel} onChange={(event) => onModel(event.target.value)}>{models.map((model) => <option key={model.modelId} value={model.modelId}>{model.name}</option>)}</select></label>
              <label className="effort-field"><span>{t("settings.effort")}</span>{activeModel?.supportsReasoningEffort ? <EffortSlider alwaysOpen efforts={activeModel.reasoningEfforts} value={selectedEffort} onChange={onEffort} /> : <span className="settings-empty">{t("settings.effortUnsupported")}</span>}</label>
              <div className="capability-note"><ShieldCheck size={15} /><span>{activeModel?.totalContextTokens ? t("settings.contextK", { n: Math.round(activeModel.totalContextTokens / 1000) }) : t("settings.contextUnknown")} · {activeModel?.supportsReasoningEffort ? t("settings.effortOn") : t("settings.effortOff")}</span></div>
              {modes && modes.availableModes.length > 0 && (
                <label><span>{t("settings.sessionMode")}</span><select value={modes.currentModeId} onChange={(event) => onMode(event.target.value)}>{modes.availableModes.map((mode) => <option key={mode.id} value={mode.id}>{mode.name}</option>)}</select></label>
              )}
              {extraConfig.map((option) =>
                option.type === "boolean" ? (
                  <label className="toggle-row compact" key={option.id}>
                    <div><strong>{option.name}</strong><span>{option.category ?? t("settings.sessionConfig")}</span></div>
                    <input type="checkbox" checked={option.currentValue === true} onChange={(event) => onConfig(option.id, event.target.checked)} />
                  </label>
                ) : (
                  <label key={option.id}>
                    <span>{option.name}</span>
                    <select value={String(option.currentValue)} onChange={(event) => onConfig(option.id, event.target.value)}>
                      {(option.options ?? []).map((entry) => {
                        const value = String(entry.value ?? entry.id ?? "");
                        const label = String(entry.name ?? entry.label ?? value);
                        return <option key={value} value={value}>{label}</option>;
                      })}
                    </select>
                  </label>
                ),
              )}
            </div>
          ) : <p className="settings-empty">{t("settings.modelsEmpty")}</p>}
        </section>

        <section className="settings-section">
          <div className="settings-section-title"><ShieldCheck size={16} /><div><strong>{t("settings.security")}</strong><span>{t("settings.securityHint")}</span></div></div>
          <div className="settings-fields">
            <label>
              <span>{t("settings.permission")}</span>
              <select value={permissionMode} onChange={(event) => onPermissionMode(event.target.value as PermissionModeId)}>
                {PERMISSION_MODES.map((mode) => (
                  <option key={mode.id} value={mode.id}>{t(`perm.${mode.id}.label`)} · {t(`perm.${mode.id}.detail`)}</option>
                ))}
              </select>
            </label>
          </div>
        </section>

        <section className="settings-section">
          <div className="settings-section-title"><MousePointer2 size={16} /><div><strong>{t("settings.computer")}</strong><span>{t("settings.computerHint")}</span></div></div>
          <label className="toggle-row">
            <div>
              <strong>{t("settings.computerAllow")}</strong>
              <span>{t("settings.computerAllowHint")}</span>
            </div>
            <input
              type="checkbox"
              checked={computerControl}
              disabled={computerBusy}
              onChange={(event) => {
                const value = event.target.checked;
                setComputerBusy(true);
                void invoke("set_computer_control", { enabled: value })
                  .then(async () => {
                    setComputerControl(value);
                    await persist("desktop.control", value, t("saved.computer"));
                    onComputerControl?.(value);
                  })
                  .catch((error) => {
                    setComputerControl(!value);
                    onError(String(error));
                  })
                  .finally(() => setComputerBusy(false));
              }}
            />
          </label>
          <div className="settings-fields">
            <label>
              <span>{t("settings.capture")}</span>
              <select
                value={captureDetail}
                disabled={!computerControl}
                onChange={(event) => {
                  const value = event.target.value;
                  setCaptureDetail(value);
                  void invoke("set_capture_detail", { detail: value })
                    .then(() => persist("desktop.captureDetail", value, t("saved.capture")))
                    .catch((error) => onError(String(error)));
                }}
              >
                <option value="low">{t("settings.capture.low")}</option>
                <option value="high">{t("settings.capture.high")}</option>
              </select>
            </label>
          </div>
        </section>

        <section className="settings-section">
          <div className="settings-section-title"><ShieldCheck size={16} /><div><strong>{t("settings.privacy")}</strong><span>{t("settings.privacyHint")}</span></div></div>
          <label className="toggle-row"><div><strong>{t("settings.saveHistory")}</strong><span>{t("settings.saveHistoryHint")}</span></div><input type="checkbox" checked={saveHistory} onChange={(event) => { const value = event.target.checked; onSaveHistory(value); void persist("privacy.saveHistory", value, t("saved.history")); }} /></label>
          <label className="toggle-row"><div><strong>{t("settings.telemetry")}</strong><span>{t("settings.telemetryHint")}</span></div><input type="checkbox" checked={telemetry} onChange={(event) => { const value = event.target.checked; setTelemetry(value); void persist("privacy.telemetry", value, t("saved.telemetry")); }} /></label>
        </section>

        <section className="settings-section">
          <div className="settings-section-title"><Wrench size={16} /><div><strong>{t("settings.go")}</strong><span>{t("settings.goHint")}</span></div></div>
          <label className="toggle-row"><div><strong>{t("settings.goToggle")}</strong><span>{t("settings.goToggleHint")}</span></div><input type="checkbox" checked={goMode} onChange={(event) => onGoMode(event.target.checked)} /></label>
        </section>

        <section className="settings-section">
          <div className="settings-section-title"><BellRing size={16} /><div><strong>{t("settings.updates")}</strong><span>{t("settings.updatesHint")}</span></div></div>
          <div className="settings-fields"><label><span>{t("settings.channel")}</span><select value={updateChannel} onChange={(event) => { const value = event.target.value; setUpdateChannel(value); void persist("updates.channel", value, t("saved.updates")); }}><option value="stable">{t("settings.channel.stable")}</option><option value="preview">{t("settings.channel.preview")}</option></select></label></div>
        </section>

        <section className="settings-section">
          <div className="settings-section-title"><FileDown size={16} /><div><strong>{t("settings.support")}</strong><span>{t("settings.supportHint")}</span></div></div>
          <button className="secondary-action" onClick={() => void exportDiagnostics()}><FileDown size={14} />{t("settings.export")}</button>
        </section>
      </div>
    </section>
  );
}
