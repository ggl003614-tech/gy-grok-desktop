import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import {
  Camera,
  ChevronRight,
  Code2,
  FolderPlus,
  FolderSearch,
  GitBranch,
  ImagePlus,
  Plug,
  Plus,
  ScanSearch,
} from "lucide-react";
import { CHECK_ACTIONS, type CheckActionId } from "./reviewActions";
import { useT } from "./i18n";

const CHECK_ICONS = {
  local: GitBranch,
  project: FolderSearch,
  quality: Code2,
} as const;

export const COMPOSER_PLUS_ITEMS = [
  { id: "files" },
  { id: "folder" },
  { id: "screenshot" },
  { id: "check" },
  { id: "connectors" },
] as const;

export function ComposerPlus({
  disabled,
  connectorCount,
  onAddFiles,
  onAddFolder,
  onScreenshot,
  onCheck,
  onOpenExtensions,
}: {
  disabled?: boolean;
  connectorCount?: number;
  onAddFiles: () => void;
  onAddFolder: () => void;
  onScreenshot: () => void;
  onCheck: (id: CheckActionId) => void;
  onOpenExtensions: () => void;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [showCheck, setShowCheck] = useState(false);
  const [floatStyle, setFloatStyle] = useState<CSSProperties>({});
  const root = useRef<HTMLDivElement>(null);
  const menu = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const box = root.current?.getBoundingClientRect();
      if (!box) return;
      setFloatStyle({
        position: "fixed",
        left: Math.max(12, Math.min(box.left, window.innerWidth - 260)),
        bottom: Math.max(12, window.innerHeight - box.top + 8),
        zIndex: 90,
      });
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open, showCheck]);

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: MouseEvent) => {
      const target = event.target as Node;
      if (root.current?.contains(target) || menu.current?.contains(target)) return;
      setOpen(false);
      setShowCheck(false);
    };
    document.addEventListener("mousedown", onPointer);
    return () => document.removeEventListener("mousedown", onPointer);
  }, [open]);

  return (
    <div className="composer-plus" ref={root}>
      <button
        type="button"
        className="attach-button plus"
        title={t("plus.add")}
        aria-label={t("plus.aria")}
        aria-expanded={open}
        disabled={disabled}
        onClick={() => {
          setOpen((value) => !value);
          setShowCheck(false);
        }}
      >
        <Plus size={16} />
      </button>
      {open && createPortal(
        <div className="plus-menu floating" role="menu" ref={menu} style={floatStyle}>
          <button
            role="menuitem"
            onClick={() => {
              setOpen(false);
              onAddFiles();
            }}
          >
            <ImagePlus size={15} />
            <span>{t("plus.files")}</span>
          </button>
          <button
            role="menuitem"
            onClick={() => {
              setOpen(false);
              onAddFolder();
            }}
          >
            <FolderPlus size={15} />
            <span>{t("plus.folder")}</span>
          </button>
          <button
            role="menuitem"
            onClick={() => {
              setOpen(false);
              onScreenshot();
            }}
          >
            <Camera size={15} />
            <span>{t("plus.screenshot")}</span>
          </button>
          <button
            role="menuitem"
            className={showCheck ? "on" : ""}
            onClick={() => setShowCheck((value) => !value)}
          >
            <ScanSearch size={15} />
            <span>{t("plus.check")}</span>
            <ChevronRight size={14} />
          </button>
          {showCheck && (
            <div className="plus-connectors plus-check">
              {CHECK_ACTIONS.map((action) => {
                const Icon = CHECK_ICONS[action.id];
                return (
                  <button
                    key={action.id}
                    role="menuitem"
                    onClick={() => {
                      setOpen(false);
                      onCheck(action.id);
                    }}
                  >
                    <Icon size={15} />
                    <span>
                      {t(`check.${action.id}.label`)}
                      <small>{t(`check.${action.id}.detail`)}</small>
                    </span>
                  </button>
                );
              })}
            </div>
          )}
          <button
            role="menuitem"
            onClick={() => {
              setOpen(false);
              onOpenExtensions();
            }}
          >
            <Plug size={15} />
            <span>{t("plus.connectors")}</span>
            {connectorCount ? <em>{connectorCount}</em> : null}
          </button>
        </div>,
        document.body,
      )}
    </div>
  );
}
