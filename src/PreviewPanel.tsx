import { useEffect, useRef, useState } from "react";
import { ExternalLink, RefreshCw, X } from "lucide-react";
import { isSafePreviewUrl } from "./sessionUpdates";
import { useT } from "./i18n";

export function PreviewPanel({
  url,
  draft,
  nonce,
  onDraft,
  onOpen,
  onRefresh,
  onExternal,
  onExit,
}: {
  url: string;
  draft: string;
  nonce: number;
  onDraft: (value: string) => void;
  onOpen: (value: string) => void;
  onRefresh: () => void;
  onExternal: (value: string) => void;
  onExit: () => void;
}) {
  const t = useT();
  const [frameError, setFrameError] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const valid = isSafePreviewUrl(url);

  // Esc 退出预览。iframe 抢焦点时事件到不了这里，所以按钮才是主出口。
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onExit();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onExit]);

  return (
    <div className="preview-panel">
      <div className="preview-bar">
        <form
          className="preview-url"
          onSubmit={(event) => {
            event.preventDefault();
            onOpen(draft.trim());
            setFrameError(false);
            inputRef.current?.blur();
          }}
        >
          <input
            ref={inputRef}
            value={draft}
            onChange={(event) => onDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.stopPropagation();
                onDraft(url);
                inputRef.current?.blur();
              }
            }}
            placeholder="http://localhost:5173"
            aria-label={t("preview.address")}
            spellCheck={false}
          />
        </form>
        <button type="button" onClick={onRefresh} title={t("common.refresh")} aria-label={t("common.refresh")}>
          <RefreshCw size={14} />
        </button>
        <button
          type="button"
          disabled={!valid}
          onClick={() => onExternal(url)}
          title={t("preview.openBrowser")}
          aria-label={t("preview.openBrowser")}
        >
          <ExternalLink size={14} />
        </button>
        <button type="button" onClick={onExit} title={t("preview.exit")} aria-label={t("preview.exit")}>
          <X size={14} />
        </button>
      </div>
      {valid ? (
        <iframe
          key={`${url}#${nonce}`}
          className="preview-frame"
          title={t("activity.preview")}
          src={url}
          sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
          onLoad={() => setFrameError(false)}
          onError={() => setFrameError(true)}
        />
      ) : (
        <div className="preview-empty">
          <p>{t("preview.emptyTitle")}</p>
          <p>{t("preview.emptyHint")}</p>
        </div>
      )}
      {valid && frameError && <p className="preview-hint">{t("preview.loadFailed")}</p>}
    </div>
  );
}
