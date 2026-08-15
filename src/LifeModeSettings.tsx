import { useEffect, useRef, useState } from "react";
import { Plus, Sunrise, Trash2 } from "lucide-react";
import { useT } from "./i18n";
import {
  newLifeWindow,
  type LifePreviewKind,
  type LifeModeConfig,
  type LifeUnlockMode,
} from "./lifeMode";

export function LifeModeSettings({
  config,
  usedToday,
  budget,
  onChange,
  sealed,
  onPreview,
  resetToken,
}: {
  config: LifeModeConfig;
  usedToday?: number;
  budget?: number;
  onChange: (next: LifeModeConfig) => void;
  sealed?: boolean;
  onPreview?: (reason: LifePreviewKind) => void;
  resetToken?: number;
}) {
  const t = useT();
  const [percent, setPercent] = useState(config.dailyPercent);
  const percentRef = useRef(config.dailyPercent);
  const dragging = useRef(false);
  const set = (patch: Partial<LifeModeConfig>) => onChange({ ...config, ...patch });

  useEffect(() => {
    percentRef.current = config.dailyPercent;
    setPercent(config.dailyPercent);
  }, [config.dailyPercent, resetToken]);

  const showPercent = (value: number) => {
    percentRef.current = value;
    setPercent(value);
  };

  const commitPercent = () => {
    if (percentRef.current !== config.dailyPercent) set({ dailyPercent: percentRef.current });
  };

  return (
    <div className="life-settings">
      <label className="toggle-row">
        <div>
          <strong>{t("life.enable")}</strong>
          <span>{t("life.enableHint")}</span>
        </div>
        <input
          type="checkbox"
          checked={config.enabled}
          disabled={sealed}
          onChange={(event) => set({ enabled: event.target.checked })}
        />
      </label>
      {sealed ? <p className="life-note">{t("life.lock.sealed")}</p> : null}

      {onPreview ? (
        <div className="life-demo-row">
          <p className="life-note">{t("life.demo.hint")}</p>
          <div className="life-demo-actions">
            <button type="button" className="secondary-action compact" onClick={() => onPreview("quota")}>{t("life.demo.quota")}</button>
            <button type="button" className="secondary-action compact" onClick={() => onPreview("schedule")}>{t("life.demo.schedule")}</button>
            <button type="button" className="secondary-action compact" onClick={() => onPreview("rest")}>{t("life.demo.rest")}</button>
            <button type="button" className="secondary-action compact" onClick={() => onPreview("broke")}>{t("life.demo.broke")}</button>
            <button type="button" className="secondary-action compact" onClick={() => onPreview("xhigh")}>{t("life.demo.xhigh")}</button>
          </div>
        </div>
      ) : null}

      <div className={`life-settings-body ${config.enabled && !sealed ? "" : "off"}`}>
        <div className="settings-fields">
          <label>
            <span>{t("life.daily")}</span>
            <div className="life-percent">
              <input
                type="range"
                min={1}
                max={100}
                value={percent}
                onPointerDown={() => {
                  dragging.current = true;
                }}
                onChange={(event) => {
                  const value = Number(event.target.value);
                  showPercent(value);
                  if (!dragging.current) set({ dailyPercent: value });
                }}
                onPointerUp={() => {
                  dragging.current = false;
                  commitPercent();
                }}
                onPointerCancel={() => {
                  dragging.current = false;
                  commitPercent();
                }}
                onBlur={commitPercent}
              />
              <em>{percent}%</em>
            </div>
          </label>
        </div>
        <p className="life-note">{t("life.dailyHint")}</p>
        {config.enabled && budget != null && usedToday != null ? (
          <p className="life-note">{t("life.usedToday", { used: Math.round(usedToday), budget })}</p>
        ) : null}

        <div className="settings-fields" style={{ marginTop: 14 }}>
          <label>
            <span>{t("life.unlock")}</span>
            <select
              value={config.unlockMode}
              onChange={(event) => set({ unlockMode: event.target.value as LifeUnlockMode })}
            >
              <option value="midnight">{t("life.unlock.midnight")}</option>
              <option value="time">{t("life.unlock.time")}</option>
              <option value="hours">{t("life.unlock.hours")}</option>
            </select>
          </label>
          {config.unlockMode === "time" ? (
            <label>
              <span>{t("life.unlock.timeAt")}</span>
              <input
                type="time"
                value={config.unlockTime}
                onChange={(event) => set({ unlockTime: event.target.value || "08:00" })}
              />
            </label>
          ) : null}
          {config.unlockMode === "hours" ? (
            <label>
              <span>{t("life.unlock.restFor")}</span>
              <input
                type="number"
                min={1}
                max={24}
                value={config.restHours}
                onChange={(event) => set({ restHours: Math.max(1, Math.min(24, Number(event.target.value) || 4)) })}
              />
            </label>
          ) : null}
        </div>

        <div className="life-windows">
          <div className="life-windows-head">
            <div>
              <strong>{t("life.windows")}</strong>
              <span>{t("life.windowsHint")}</span>
            </div>
            <button
              type="button"
              className="secondary-action compact"
              disabled={config.windows.length >= 6}
              onClick={() => set({ windows: [...config.windows, { ...newLifeWindow(), percent: config.dailyPercent }] })}
            >
              <Plus size={14} /> {t("life.window.add")}
            </button>
          </div>
          {config.windows.length === 0 ? (
            <p className="life-note">{t("life.windowsEmpty")}</p>
          ) : (
            config.windows.map((window) => (
              <div className="life-window" key={window.id}>
                <label>
                  <span>{t("life.window.from")}</span>
                  <input
                    type="time"
                    value={window.start}
                    onChange={(event) =>
                      set({
                        windows: config.windows.map((item) =>
                          item.id === window.id ? { ...item, start: event.target.value || item.start } : item,
                        ),
                      })
                    }
                  />
                </label>
                <label>
                  <span>{t("life.window.to")}</span>
                  <input
                    type="time"
                    value={window.end}
                    onChange={(event) =>
                      set({
                        windows: config.windows.map((item) =>
                          item.id === window.id ? { ...item, end: event.target.value || item.end } : item,
                        ),
                      })
                    }
                  />
                </label>
                <label>
                  <span>{t("life.window.percent")}</span>
                  <input
                    type="number"
                    min={1}
                    max={100}
                    value={window.percent}
                    onChange={(event) =>
                      set({
                        windows: config.windows.map((item) =>
                          item.id === window.id ? { ...item, percent: Math.max(1, Math.min(100, Number(event.target.value) || 1)) } : item,
                        ),
                      })
                    }
                  />
                </label>
                <button
                  type="button"
                  className="icon-button"
                  aria-label={t("life.window.remove")}
                  onClick={() => set({ windows: config.windows.filter((item) => item.id !== window.id) })}
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

export function LifeModeTitle() {
  const t = useT();
  return (
    <div className="settings-section-title">
      <Sunrise size={16} />
      <div>
        <strong>{t("life.mode")}</strong>
        <span>{t("life.modeHint")}</span>
      </div>
    </div>
  );
}
