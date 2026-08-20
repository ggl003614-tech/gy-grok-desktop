import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { LoaderCircle } from "lucide-react";
import { useT } from "./i18n";
import { loadThreadSpend } from "./threadSpend";
import {
  dayBuckets,
  filterByRange,
  heatLevel,
  heatmapGrid,
  summarize,
  type UsageRange,
  type UsageSession,
} from "./usageStats";

const RANGES: UsageRange[] = ["all", "30d", "7d"];

function formatCount(value: number) {
  if (value >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(1)}B`;
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 10_000) return `${(value / 1000).toFixed(1)}k`;
  return value.toLocaleString();
}

export function UsagePanel() {
  const t = useT();
  const [sessions, setSessions] = useState<UsageSession[] | null>(null);
  const [range, setRange] = useState<UsageRange>("all");
  const [error, setError] = useState("");
  // 渲染期间固定「现在」，免得连续天数和热力图在同一帧里用不同的今天。
  const [now] = useState(() => Date.now());

  useEffect(() => {
    let alive = true;
    void invoke<UsageSession[]>("list_grok_sessions", {})
      .then((list) => {
        if (alive) setSessions(Array.isArray(list) ? list : []);
      })
      .catch((reason) => {
        if (alive) {
          setError(String(reason));
          setSessions([]);
        }
      });
    return () => {
      alive = false;
    };
  }, []);

  const view = useMemo(() => {
    if (!sessions) return null;
    const scoped = filterByRange(sessions, range, now);
    // 每线程花销存在 localStorage 里，只覆盖在这个 GUI 里跑过的线程。
    const tokensBySession: Record<string, number> = {};
    for (const session of scoped) {
      const spend = loadThreadSpend(session.sessionId);
      if (spend.total > 0) tokensBySession[session.sessionId] = spend.total;
    }
    const totals = summarize(scoped, tokensBySession, now);
    const buckets = dayBuckets(scoped);
    const busiest = buckets.reduce((max, bucket) => Math.max(max, bucket.messages), 0);
    return { totals, grid: heatmapGrid(buckets, now), busiest };
  }, [sessions, range, now]);

  if (!sessions) {
    return (
      <div className="usage-loading">
        <LoaderCircle size={15} className="spin" /> {t("usage.loading")}
      </div>
    );
  }

  const totals = view!.totals;
  const cards: { label: string; value: string; note?: string }[] = [
    { label: t("usage.sessions"), value: formatCount(totals.sessions) },
    { label: t("usage.messages"), value: formatCount(totals.messages) },
    {
      label: t("usage.tokens"),
      value: formatCount(totals.tokens),
      // 说清楚这个数覆盖到哪儿，别让人以为它是全量。
      note: t("usage.tokensNote", { n: totals.tokensFromThreads, total: totals.sessions }),
    },
    { label: t("usage.activeDays"), value: formatCount(totals.activeDays) },
    { label: t("usage.currentStreak"), value: t("usage.days", { n: totals.currentStreak }) },
    { label: t("usage.longestStreak"), value: t("usage.days", { n: totals.longestStreak }) },
    {
      label: t("usage.peakHour"),
      value: totals.peakHour == null ? "—" : t("usage.hour", { n: totals.peakHour }),
    },
    { label: t("usage.favoriteModel"), value: totals.favoriteModel ?? "—" },
  ];

  return (
    <section className="usage-stats">
      <div className="usage-head">
        <h3>{t("usage.title")}</h3>
        <div className="usage-ranges" role="tablist">
          {RANGES.map((option) => (
            <button
              key={option}
              role="tab"
              aria-selected={range === option}
              className={range === option ? "on" : ""}
              onClick={() => setRange(option)}
            >
              {t(`usage.range.${option}`)}
            </button>
          ))}
        </div>
      </div>

      {error ? <p className="usage-error">{t("usage.failed", { reason: error })}</p> : null}

      <div className="usage-grid">
        {cards.map((card) => (
          <div className="usage-card" key={card.label} title={card.note}>
            <span>{card.label}</span>
            <strong>{card.value}</strong>
            {card.note ? <small>{card.note}</small> : null}
          </div>
        ))}
      </div>

      <div className="usage-heatmap" aria-hidden="true">
        {view!.grid.map((row, index) => (
          <div className="heat-row" key={index}>
            {row.map((cell) => (
              <i
                key={cell.day}
                className={`heat level-${heatLevel(cell.messages, view!.busiest)}`}
                title={cell.messages >= 0 ? `${cell.day} · ${cell.messages}` : undefined}
              />
            ))}
          </div>
        ))}
      </div>
      <p className="usage-foot">{t("usage.heatmapNote")}</p>
    </section>
  );
}
