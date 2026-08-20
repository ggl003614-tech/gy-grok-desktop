import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Check, ChevronDown } from "lucide-react";

export interface QuietOption {
  value: string;
  label: string;
  /** 可选的第二行说明，权限模式那种需要解释的用得上。 */
  hint?: string;
}

/**
 * 输入栏里的下拉。
 *
 * 存在的理由：原生 `<select>` 的弹出层是系统画的，Windows 上是一块深灰底、
 * 黑色高亮的方角菜单，跟界面其它部分完全不是一套东西 —— 而且 CSS 改不动它。
 * 这里自己画一个，样式跟界面一致。
 *
 * 键盘操作照原生的来：上下移动、Enter/Space 选中、Esc 关闭、Home/End 到两端，
 * 失焦自动关。不做搜索跳转（选项就几个，用不上）。
 */
export function QuietSelect({
  value,
  options,
  disabled,
  ariaLabel,
  title,
  icon,
  onChange,
}: {
  value: string;
  options: QuietOption[];
  disabled?: boolean;
  ariaLabel: string;
  title?: string;
  icon?: ReactNode;
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const listId = useId();

  const selected = options.find((option) => option.value === value);
  const selectedIndex = Math.max(0, options.findIndex((option) => option.value === value));

  // 点到别处就关。用 pointerdown 而不是 click —— 点在别的按钮上时，
  // 要先关掉再让那个按钮处理，否则弹层会盖住它的点击。
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    window.addEventListener("pointerdown", onPointerDown);
    return () => window.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  const commit = (index: number) => {
    const option = options[index];
    if (option) onChange(option.value);
    setOpen(false);
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (disabled) return;
    if (!open) {
      if (event.key === "Enter" || event.key === " " || event.key === "ArrowDown") {
        event.preventDefault();
        setActive(selectedIndex);
        setOpen(true);
      }
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      setOpen(false);
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      setActive((current) => Math.min(options.length - 1, current + 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((current) => Math.max(0, current - 1));
    } else if (event.key === "Home") {
      event.preventDefault();
      setActive(0);
    } else if (event.key === "End") {
      event.preventDefault();
      setActive(options.length - 1);
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      commit(active);
    }
  };

  return (
    <div className="quiet-select" ref={rootRef}>
      <button
        type="button"
        className={`quiet-trigger${open ? " open" : ""}`}
        disabled={disabled}
        title={title}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        onClick={() => {
          if (disabled) return;
          setActive(selectedIndex);
          setOpen((current) => !current);
        }}
        onKeyDown={onKeyDown}
      >
        {icon}
        <span>{selected?.label ?? value}</span>
        <ChevronDown size={13} className="chev" />
      </button>
      {open ? (
        <div className="quiet-menu" role="listbox" id={listId} aria-label={ariaLabel}>
          {options.map((option, index) => (
            <button
              type="button"
              key={option.value}
              role="option"
              aria-selected={option.value === value}
              className={`quiet-item${index === active ? " active" : ""}${option.value === value ? " on" : ""}`}
              onPointerEnter={() => setActive(index)}
              onClick={() => commit(index)}
            >
              <span className="tick">{option.value === value ? <Check size={13} /> : null}</span>
              <span className="body">
                <strong>{option.label}</strong>
                {option.hint ? <small>{option.hint}</small> : null}
              </span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
