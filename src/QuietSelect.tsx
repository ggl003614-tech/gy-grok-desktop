import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
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
 *
 * 菜单用 portal 挂到 body 上，不留在触发按钮旁边。原因是实打实踩过的坑：
 * `.model-controls` 上有 `overflow: hidden`（防控件行溢出用的），菜单作为
 * 它的后代会被整个裁掉 —— 点了有反应、状态也变了，但什么都看不见，
 * 表现得就像按钮失灵。原生 select 没这问题是因为它的弹层是系统窗口，
 * 不归 CSS 管。挂到 body 上就绕开了所有祖先的裁剪和层叠上下文。
 *
 * 键盘操作照原生的来：上下移动、Enter/Space 选中、Esc 关闭、Home/End 到两端。
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
  const [box, setBox] = useState({ left: 0, bottom: 0 });
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const listId = useId();

  const selected = options.find((option) => option.value === value);
  const selectedIndex = Math.max(0, options.findIndex((option) => option.value === value));

  /** 菜单挂在 body 上，位置得自己算：贴着触发按钮上方，右侧不能出屏。 */
  const place = useCallback(() => {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const width = menuRef.current?.offsetWidth ?? 190;
    const left = Math.min(rect.left, window.innerWidth - width - 8);
    setBox({ left: Math.max(8, left), bottom: window.innerHeight - rect.top + 6 });
  }, []);

  // 打开的瞬间就要摆好，否则会先在旧位置闪一下。
  useLayoutEffect(() => {
    if (open) place();
  }, [open, place]);

  useEffect(() => {
    if (!open) return;
    // 点到别处就关。用 pointerdown 而不是 click —— 点在别的按钮上时要先关掉，
    // 再让那个按钮处理自己的点击。
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (triggerRef.current?.contains(target)) return;
      if (menuRef.current?.contains(target)) return;
      setOpen(false);
    };
    // 菜单是 fixed 定位的，窗口一动就得重新贴上去，否则会飘在原地。
    const onReflow = () => place();
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("resize", onReflow);
    window.addEventListener("scroll", onReflow, true);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("resize", onReflow);
      window.removeEventListener("scroll", onReflow, true);
    };
  }, [open, place]);

  const commit = (index: number) => {
    const option = options[index];
    if (option) onChange(option.value);
    setOpen(false);
    triggerRef.current?.focus();
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
    <div className="quiet-select">
      <button
        ref={triggerRef}
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
      {open
        ? createPortal(
            <div
              ref={menuRef}
              className="quiet-menu"
              role="listbox"
              id={listId}
              aria-label={ariaLabel}
              style={{ left: box.left, bottom: box.bottom }}
              onKeyDown={onKeyDown}
            >
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
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
