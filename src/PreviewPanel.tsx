import { useMemo, useState } from "react";
import { ExternalLink, RefreshCw } from "lucide-react";
import { isSafePreviewUrl } from "./sessionUpdates";

const PRESETS = [
  "http://localhost:5173",
  "http://localhost:3000",
  "http://localhost:4173",
  "http://localhost:8080",
];

export function PreviewPanel({
  url,
  draft,
  nonce,
  suggestions,
  onDraft,
  onOpen,
  onRefresh,
  onExternal,
}: {
  url: string;
  draft: string;
  nonce: number;
  suggestions: string[];
  onDraft: (value: string) => void;
  onOpen: (value: string) => void;
  onRefresh: () => void;
  onExternal: (value: string) => void;
}) {
  const [frameError, setFrameError] = useState(false);
  const valid = isSafePreviewUrl(url);
  const options = useMemo(
    () => [...new Set([...suggestions, ...PRESETS])],
    [suggestions],
  );

  return (
    <div className="preview-panel">
      <form
        className="preview-bar"
        onSubmit={(event) => {
          event.preventDefault();
          onOpen(draft.trim());
          setFrameError(false);
        }}
      >
        <input
          value={draft}
          onChange={(event) => onDraft(event.target.value)}
          placeholder="http://localhost:5173"
          aria-label="预览地址"
          spellCheck={false}
        />
        <button type="submit">打开</button>
        <button type="button" onClick={onRefresh} title="刷新" aria-label="刷新预览">
          <RefreshCw size={14} />
        </button>
        <button
          type="button"
          disabled={!valid}
          onClick={() => onExternal(url)}
          title="用浏览器打开"
          aria-label="用浏览器打开"
        >
          <ExternalLink size={14} />
        </button>
      </form>
      <div className="preview-presets">
        {options.map((entry) => (
          <button
            key={entry}
            className={entry === url ? "on" : ""}
            onClick={() => {
              onDraft(entry);
              onOpen(entry);
              setFrameError(false);
            }}
          >
            {entry.replace(/^https?:\/\//, "")}
          </button>
        ))}
      </div>
      {valid ? (
        <iframe
          key={`${url}#${nonce}`}
          className="preview-frame"
          title="网站预览"
          src={url}
          sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
          onLoad={() => setFrameError(false)}
          onError={() => setFrameError(true)}
        />
      ) : (
        <div className="preview-empty">
          <p>网站跑起来后，把本地地址填在上面。</p>
          <p>对话里出现 `localhost` 链接时，也会自动跳到这一栏。</p>
        </div>
      )}
      {valid && frameError && (
        <p className="preview-hint">页面没加载到。确认开发服务器已启动，并且允许被嵌入。</p>
      )}
    </div>
  );
}
