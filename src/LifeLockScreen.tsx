import { useEffect } from "react";
import { Sunrise } from "lucide-react";
import { useT } from "./i18n";
import type { LifeConfirmRequest, LifeLockView } from "./lifeMode";

function formatUnlock(iso: string | null) {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString(undefined, {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function remainingLabel(iso: string | null, t: (key: string, vars?: Record<string, string | number>) => string) {
  if (!iso) return "";
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return t("life.unlockSoon");
  const minutes = Math.ceil(ms / 60000);
  if (minutes < 60) return t("life.remainMins", { n: minutes });
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? t("life.remainHoursMins", { h: hours, m: rest }) : t("life.remainHours", { n: hours });
}

export function LifeLockScreen({
  lock,
  demo,
  sealed,
  onEndDemo,
}: {
  lock: LifeLockView;
  demo?: boolean;
  sealed?: boolean;
  onEndDemo?: () => void;
}) {
  const t = useT();
  const title =
    lock.reason === "schedule"
      ? t("life.lock.scheduleTitle")
      : lock.reason === "rest"
        ? t("life.lock.restTitle")
        : t("life.lock.quotaTitle");
  const body =
    lock.reason === "schedule"
      ? t("life.lock.scheduleBody")
      : lock.reason === "rest"
        ? t("life.lock.restBody")
        : t("life.lock.quotaBody", { n: lock.budget });

  return (
    <div className="life-lock" role="dialog" aria-modal="true" aria-labelledby="life-lock-title">
      <div className="life-lock-sky" aria-hidden>
        <i />
        <i />
        <i />
      </div>
      <div className="life-lock-card">
        <span className="life-lock-mark"><Sunrise size={22} /></span>
        <p className="eyebrow">{demo ? t("life.demo.badge") : t("life.mode")}</p>
        <h1 id="life-lock-title">{title}</h1>
        <p className="life-lock-copy">{body}</p>
        <p className="life-lock-until">
          {remainingLabel(lock.until, t)}
          {lock.until ? <span>{t("life.unlockAt", { time: formatUnlock(lock.until) })}</span> : null}
        </p>
        {lock.reason !== "schedule" ? (
          <p className="life-lock-meter">
            {t("life.usedToday", { used: Math.round(lock.usedToday), budget: lock.budget })}
          </p>
        ) : null}
        {sealed ? <p className="life-lock-seal">{t("life.lock.sealed")}</p> : null}
        {demo ? (
          <div className="life-lock-actions">
            <button type="button" className="primary-action" onClick={onEndDemo}>
              {t("life.demo.end")}
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}

export function LifeConfirmDialog({
  request,
  onAccept,
  onCancel,
}: {
  request: LifeConfirmRequest;
  onAccept: () => void;
  onCancel: () => void;
}) {
  const t = useT();
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);
  const time = formatUnlock(request.lock.until);
  const title =
    request.kind === "enable"
      ? t("life.confirm.enableTitle")
      : request.kind === "usage"
        ? t("life.confirm.usageTitle")
        : t("life.confirm.sealTitle");
  const body =
    request.kind === "enable"
      ? t("life.confirm.enableBody")
      : request.kind === "usage"
        ? t("life.confirm.usageBody", { n: request.lock.budget, time })
        : t("life.confirm.sealBody", { time });
  const accept = request.kind === "enable" ? t("life.confirm.enable") : t("life.confirm.lock");

  return (
    <div className="modal-backdrop" role="presentation" onClick={onCancel}>
      <div
        className="life-confirm"
        role="dialog"
        aria-modal="true"
        aria-labelledby="life-confirm-title"
        onClick={(event) => event.stopPropagation()}
      >
        <span className="life-lock-mark"><Sunrise size={22} /></span>
        <p className="eyebrow">{t("life.mode")}</p>
        <h2 id="life-confirm-title">{title}</h2>
        <p className="dialog-description">{body}</p>
        {request.lock.until ? (
          <p className="life-lock-until">
            {remainingLabel(request.lock.until, t)}
            <span>{t("life.unlockAt", { time })}</span>
          </p>
        ) : null}
        {request.kind === "usage" ? <p className="life-note">{t("life.confirm.usageHint")}</p> : null}
        <div className="dialog-actions">
          <button type="button" className="secondary-action" autoFocus onClick={onCancel}>
            {t("life.confirm.notYet")}
          </button>
          <button type="button" className="primary-action" onClick={onAccept}>
            {accept}
          </button>
        </div>
      </div>
    </div>
  );
}

export function LifeBrokeDialog({
  kind,
  onAccept,
  onCancel,
}: {
  kind: "scold" | "xhigh";
  onAccept: () => void;
  onCancel?: () => void;
}) {
  const t = useT();
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") (onCancel ?? onAccept)();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onAccept, onCancel]);
  const title = kind === "scold" ? t("life.broke.title") : t("life.broke.xhighTitle");
  const body = kind === "scold" ? t("life.broke.body") : t("life.broke.xhighBody");

  return (
    <div className="modal-backdrop" role="presentation" onClick={onCancel ?? onAccept}>
      <div
        className="life-confirm"
        role="dialog"
        aria-modal="true"
        aria-labelledby="life-broke-title"
        onClick={(event) => event.stopPropagation()}
      >
        <span className="life-lock-mark"><Sunrise size={22} /></span>
        <p className="eyebrow">{t("life.mode")}</p>
        <h2 id="life-broke-title">{title}</h2>
        <p className="dialog-description">{body}</p>
        <div className="dialog-actions">
          {kind === "xhigh" && onCancel ? (
            <button type="button" className="secondary-action" autoFocus onClick={onCancel}>
              {t("life.broke.notNow")}
            </button>
          ) : null}
          <button type="button" className="primary-action" autoFocus={kind === "scold"} onClick={onAccept}>
            {kind === "scold" ? t("life.broke.ok") : t("life.broke.promise")}
          </button>
        </div>
      </div>
    </div>
  );
}
