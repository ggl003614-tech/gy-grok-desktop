import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import {
  displayEffortLabel,
  effortStage,
  effortWorldKey,
  sortEfforts,
  type EffortOption,
  type EffortStage,
} from "./effort";
import { useT } from "./i18n";
import grokLogo from "./assets/grok-mark.png";

export const XHIGH_INTRO_KEY = "grok-desk.effort.xhigh-track-intro";

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function hasSeenXhighIntro() {
  try {
    return window.localStorage.getItem(XHIGH_INTRO_KEY) === "1";
  } catch {
    return false;
  }
}

function markXhighIntro() {
  try {
    window.localStorage.setItem(XHIGH_INTRO_KEY, "1");
  } catch {
    // ignore quota / private mode
  }
}

function EffortWorldMark({ stage, grow }: { stage: EffortStage; grow?: boolean }) {
  return (
    <i className={`effort-world ${stage}${grow ? " grow" : ""}`} aria-hidden>
      <b className="effort-asteroid" />
      <b className="effort-earth">
        <i className="land" />
        <i className="cloud" />
      </b>
      <b className="effort-sun">
        <i className="rays" />
        <i className="core" />
      </b>
      <b className="effort-hole">
        <i className="effort-hole-well" />
        <i className="effort-hole-rim" />
        <i className="effort-hole-rim late" />
        <img className="effort-grok-mark" src={grokLogo} alt="" draggable={false} />
        <img className="effort-grok-mark sinking" src={grokLogo} alt="" draggable={false} />
      </b>
    </i>
  );
}

export function EffortSlider({
  efforts,
  value,
  disabled,
  alwaysOpen,
  onChange,
}: {
  efforts: EffortOption[];
  value: string;
  disabled?: boolean;
  alwaysOpen?: boolean;
  onChange: (value: string) => void;
}) {
  const ordered = sortEfforts(efforts);
  const index = Math.max(0, ordered.findIndex((effort) => effort.value === value));
  const [open, setOpen] = useState(Boolean(alwaysOpen));
  const [shownIndex, setShownIndex] = useState(index);
  const [warping, setWarping] = useState(false);
  const t = useT();
  const shown = ordered[clamp(shownIndex, 0, Math.max(0, ordered.length - 1))] ?? ordered[index];
  const stage = effortStage(shown);
  const visualRef = useRef(index);
  const drag = useRef(false);
  const lastShown = useRef(index);
  const springRaf = useRef(0);
  const track = useRef<HTMLDivElement>(null);
  const fill = useRef<HTMLElement>(null);
  const thumb = useRef<HTMLElement>(null);
  const worldNode = useRef<HTMLElement>(null);
  const root = useRef<HTMLDivElement>(null);
  const chip = useRef<HTMLButtonElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  const [floatStyle, setFloatStyle] = useState<CSSProperties>({});
  const orderedRef = useRef(ordered);
  const valueRef = useRef(value);
  const onChangeRef = useRef(onChange);
  orderedRef.current = ordered;
  valueRef.current = value;
  onChangeRef.current = onChange;

  const paint = (visual: number) => {
    const steps = orderedRef.current;
    const last = Math.max(1, steps.length - 1);
    const t = steps.length < 2 ? 0 : clamp(visual / last, 0, 1);
    const width = track.current?.clientWidth ?? 0;
    if (fill.current) fill.current.style.transform = `scaleX(${t})`;
    if (thumb.current) {
      thumb.current.style.transform = `translate3d(${t * width}px, -50%, 0) translate(-50%, 0)`;
    }
    if (worldNode.current) {
      const scale = 0.78 + t * 0.72;
      worldNode.current.style.transform = `scale(${scale})`;
    }
  };

  const reveal = (visual: number) => {
    const last = Math.max(0, orderedRef.current.length - 1);
    const next = clamp(Math.round(visual), 0, last);
    if (next === lastShown.current) return;
    lastShown.current = next;
    setShownIndex(next);
  };

  const applyFromClientX = (clientX: number, commit: boolean) => {
    const node = track.current;
    const steps = orderedRef.current;
    if (!node || steps.length < 2) return;
    const rect = node.getBoundingClientRect();
    const raw = (clientX - rect.left) / Math.max(1, rect.width);
    const rubber = raw < 0 ? raw * 0.1 : raw > 1 ? 1 + (raw - 1) * 0.1 : raw;
    const next = rubber * (steps.length - 1);
    visualRef.current = next;
    paint(next);
    reveal(next);
    if (!commit) return;
    const snapped = clamp(Math.round(raw * (steps.length - 1)), 0, steps.length - 1);
    springTo(snapped);
    const effort = steps[snapped];
    if (effort && effort.value !== valueRef.current) onChangeRef.current(effort.value);
  };

  const springTo = (target: number) => {
    if (springRaf.current) window.cancelAnimationFrame(springRaf.current);
    let velocity = 0;
    const step = () => {
      if (drag.current) return;
      const currentValue = visualRef.current;
      const pull = (target - currentValue) * 0.16;
      velocity = (velocity + pull) * 0.72;
      const next = currentValue + velocity;
      visualRef.current = next;
      paint(next);
      reveal(next);
      if (Math.abs(velocity) > 0.002 || Math.abs(target - next) > 0.006) {
        springRaf.current = window.requestAnimationFrame(step);
        return;
      }
      visualRef.current = target;
      paint(target);
      reveal(target);
      springRaf.current = 0;
    };
    springRaf.current = window.requestAnimationFrame(step);
  };

  useEffect(() => {
    if (drag.current) return;
    visualRef.current = index;
    lastShown.current = index;
    setShownIndex(index);
    paint(index);
  }, [index, ordered.length]);

  useLayoutEffect(() => {
    paint(visualRef.current);
  }, [open, ordered.length, stage]);

  useLayoutEffect(() => {
    if (!open || alwaysOpen) return;
    const place = () => {
      const box = chip.current?.getBoundingClientRect();
      if (!box) return;
      const width = 280;
      const left = Math.max(12, Math.min(box.left, window.innerWidth - width - 12));
      setFloatStyle({
        position: "fixed",
        left,
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
  }, [alwaysOpen, open, stage]);

  useEffect(() => {
    if (!open || alwaysOpen) return;
    const onPointer = (event: MouseEvent) => {
      if (drag.current) return;
      const target = event.target as Node;
      if (root.current?.contains(target) || pop.current?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", onPointer);
    return () => document.removeEventListener("mousedown", onPointer);
  }, [alwaysOpen, open]);

  useEffect(() => {
    const onMove = (event: PointerEvent) => {
      if (!drag.current) return;
      applyFromClientX(event.clientX, false);
    };
    const onUp = (event: PointerEvent) => {
      if (!drag.current) return;
      drag.current = false;
      applyFromClientX(event.clientX, true);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      if (springRaf.current) window.cancelAnimationFrame(springRaf.current);
    };
  }, []);

  useEffect(() => {
    if (stage !== "xhigh" || !open || hasSeenXhighIntro()) return;
    setWarping(true);
    const done = window.setTimeout(() => {
      markXhighIntro();
      setWarping(false);
    }, 1100);
    return () => window.clearTimeout(done);
  }, [open, stage]);

  if (!ordered.length) return null;

  return (
    <div className={`effort-control stage-${stage} ${open ? "open" : ""} ${warping ? "warping" : ""}`} ref={root}>
      <button
        type="button"
        className="effort-chip"
        ref={chip}
        disabled={disabled}
        aria-expanded={open}
        aria-label={t("effort.aria")}
        onClick={() => {
          if (!alwaysOpen) setOpen((current) => !current);
        }}
      >
        <EffortWorldMark stage={stage} />
        <span>{displayEffortLabel(shown)}</span>
      </button>
      {open && (() => {
        const panel = (
        <div
          className={`effort-pop stage-${stage} ${alwaysOpen ? "" : "floating"}`}
          ref={pop}
          role="dialog"
          aria-label={t("effort.choose")}
          style={alwaysOpen ? undefined : floatStyle}
        >
          <svg className="effort-warp-svg" aria-hidden>
            <filter id="effort-track-warp" x="-12%" y="-80%" width="124%" height="260%">
              <feTurbulence type="fractalNoise" baseFrequency="0.035" numOctaves="2" seed="4" result="noise">
                <animate attributeName="baseFrequency" values="0.02;0.055;0.03" dur="1.1s" />
              </feTurbulence>
              <feDisplacementMap in="SourceGraphic" in2="noise" scale="7">
                <animate attributeName="scale" values="0;11;4;0" dur="1.1s" />
              </feDisplacementMap>
            </filter>
          </svg>
          {stage === "xhigh" ? (
            <span className="effort-field-dust" aria-hidden>
              {Array.from({ length: 24 }, (_, i) => (
                <i
                  key={i}
                  style={{
                    animationDelay: `${(i * 0.055).toFixed(3)}s`,
                    ["--sx" as string]: `${3 + ((i * 19) % 88)}%`,
                    ["--sy" as string]: `${4 + ((i * 31) % 90)}%`,
                  }}
                />
              ))}
            </span>
          ) : null}
          <div
            className="effort-track"
            ref={track}
            onPointerDown={(event) => {
              if (disabled) return;
              event.preventDefault();
              drag.current = true;
              if (springRaf.current) {
                window.cancelAnimationFrame(springRaf.current);
                springRaf.current = 0;
              }
              event.currentTarget.setPointerCapture(event.pointerId);
              applyFromClientX(event.clientX, false);
            }}
          >
            <i className="effort-fill" ref={fill} />
            {stage === "xhigh" ? (
              <span className="effort-particles" aria-hidden>
                {Array.from({ length: 22 }, (_, i) => (
                  <i
                    key={i}
                    style={{
                      animationDelay: `${(i * 0.038).toFixed(3)}s`,
                      top: `${26 + ((i * 11) % 48)}%`,
                      ["--from" as string]: `${2 + ((i * 9) % 64)}%`,
                    }}
                  />
                ))}
              </span>
            ) : null}
            <em className="effort-thumb" ref={thumb}>
              <span ref={worldNode} className="effort-thumb-scale">
                {stage === "xhigh" ? (
                  <span className="effort-orbit-dust" aria-hidden>
                    {Array.from({ length: 20 }, (_, i) => {
                      const angle = (i / 20) * Math.PI * 2 + (i % 4) * 0.28;
                      const radius = 20 + (i % 6) * 7;
                      return (
                        <i
                          key={i}
                          style={{
                            animationDelay: `${(i * 0.04).toFixed(3)}s`,
                            ["--ox" as string]: `${(Math.cos(angle) * radius).toFixed(1)}px`,
                            ["--oy" as string]: `${(Math.sin(angle) * radius).toFixed(1)}px`,
                          }}
                        />
                      );
                    })}
                  </span>
                ) : null}
                <EffortWorldMark stage={stage} grow />
              </span>
            </em>
          </div>
          <div className="effort-caption">
            <EffortWorldMark stage={stage} />
            <span>
              <strong>{displayEffortLabel(shown)}</strong>
              <small>{t(effortWorldKey(stage))}</small>
            </span>
          </div>
        </div>
        );
        return alwaysOpen ? panel : createPortal(panel, document.body);
      })()}
    </div>
  );
}
