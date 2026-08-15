import { useEffect, useRef, useState } from "react";
import { Code2, FolderSearch, GitBranch, ScanSearch } from "lucide-react";
import { CHECK_ACTIONS, type CheckActionId } from "./reviewActions";

const ICONS = {
  local: GitBranch,
  project: FolderSearch,
  quality: Code2,
} as const;

export function CheckReview({
  disabled,
  onRun,
}: {
  disabled?: boolean;
  onRun: (id: CheckActionId) => void;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: MouseEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onPointer);
    return () => document.removeEventListener("mousedown", onPointer);
  }, [open]);

  return (
    <div className="check-review" ref={root}>
      <button
        type="button"
        className={`check-button ${open ? "on" : ""}`}
        title="检查"
        aria-label="检查代码"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => setOpen((value) => !value)}
      >
        <ScanSearch size={15} />
        <span>检查</span>
      </button>
      {open && (
        <div className="check-menu" role="menu">
          {CHECK_ACTIONS.map((action) => {
            const Icon = ICONS[action.id];
            return (
              <button
                key={action.id}
                role="menuitem"
                onClick={() => {
                  setOpen(false);
                  onRun(action.id);
                }}
              >
                <Icon size={15} />
                <span>
                  {action.label}
                  <small>{action.detail}</small>
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
