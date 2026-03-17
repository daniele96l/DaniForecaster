"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useOptimization, SeriesPoint } from "./hooks/useOptimization";

// ── Types ───────────────────────────────────────────────────────────────────

type Dataset = "solar" | "wind" | "wind_raw" | "both";
type Point = { date: string; value: number };
type ApiResponse = {
  dataset: "solar" | "wind" | "wind_raw";
  year: number | null;
  years: number[];
  points: Point[];
  stats: { min: number | null; max: number | null; avg: number | null; count: number };
  error?: string;
};

// ── Data hook ────────────────────────────────────────────────────────────────

function useTimeSeries(dataset: "solar" | "wind" | "wind_raw", year: number | null) {
  const [data, setData] = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function run() {
      try {
        setLoading(true);
        setError(null);
        const params = new URLSearchParams({ dataset });
        if (dataset === "wind_raw" && year != null) params.set("year", String(year));
        const res = await fetch(`/api/data?${params.toString()}`);
        const json = (await res.json()) as ApiResponse;
        if (!res.ok || json.error) throw new Error(json.error || `HTTP ${res.status}`);
        if (!cancelled) setData(json);
      } catch (e) {
        if (!cancelled) setError(String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    run();
    return () => { cancelled = true; };
  }, [dataset, year]);

  return { data, loading, error };
}

// ── Chart ────────────────────────────────────────────────────────────────────

type SeriesEntry = { date: Date; value: number };

function Chart({
  series,
  labels,
  tooltipLabels,
  unit
}: {
  series: { solar?: Point[]; wind?: Point[] };
  labels?: { solar?: string; wind?: string };
  tooltipLabels?: { solar?: string; wind?: string };
  unit?: string;
}) {
  const [hover, setHover] = useState<{ key: "solar" | "wind"; index: number } | null>(null);

  const solarParsed = useMemo(
    () => (series.solar ?? []).map((p) => ({ date: new Date(p.date), value: p.value })),
    [series.solar]
  );
  const windParsed = useMemo(
    () => (series.wind ?? []).map((p) => ({ date: new Date(p.date), value: p.value })),
    [series.wind]
  );

  const allValues = useMemo(
    () => [...solarParsed.map((p) => p.value), ...windParsed.map((p) => p.value)],
    [solarParsed, windParsed]
  );
  const minY = allValues.length ? Math.min(...allValues) : 0;
  const maxY = allValues.length ? Math.max(...allValues) : 1;
  const spanY = maxY - minY || 1;

  const width = 900;
  const height = 280;
  const padding = 44;
  const rightExtraFraction = 0.1;

  const xScale = (i: number, count: number) =>
    padding + ((width - padding * 2) * i) / Math.max(1, (count - 1) * (1 + rightExtraFraction));
  const yScale = (v: number) =>
    height - padding - ((height - padding * 2) * (v - minY)) / spanY;

  const ticks = 4;
  const yTicks = Array.from({ length: ticks + 1 }, (_, i) => {
    const t = i / ticks;
    const v = minY + spanY * t;
    return { v, y: yScale(v) };
  });

  const refParsed = solarParsed.length ? solarParsed : windParsed;

  if (!solarParsed.length && !windParsed.length) {
    return (
      <div className="state-box">
        <span style={{ fontSize: 28, opacity: 0.3 }}>📊</span>
        <span>No data for this selection</span>
      </div>
    );
  }

  const xTickIndices = refParsed.length
    ? Array.from({ length: 5 }, (_, i) => Math.round(((refParsed.length - 1) * i) / 4))
    : [];
  const xTicks = refParsed.length
    ? Array.from(new Set(xTickIndices))
        .filter((idx) => idx >= 0 && idx < refParsed.length)
        .map((idx) => ({
          idx,
          x: xScale(idx, refParsed.length),
          label: refParsed[idx].date.toLocaleString(undefined, {
            month: "2-digit",
            day: "2-digit",
            hour: "2-digit",
            minute: "2-digit"
          })
        }))
    : [];

  const renderLine = (key: "solar" | "wind", parsed: SeriesEntry[], color: string, fillId: string) => {
    if (!parsed.length) return null;
    const count = parsed.length;
    const d = parsed
      .map((p, i) =>
        i === 0 ? `M ${xScale(i, count)} ${yScale(p.value)}` : `L ${xScale(i, count)} ${yScale(p.value)}`
      )
      .join(" ");
    const fillPath = `${d} L ${xScale(count - 1, count)} ${height - padding} L ${xScale(0, count)} ${height - padding} Z`;
    return (
      <g key={key}>
        <path d={fillPath} fill={`url(#${fillId})`} fillOpacity={0.55} />
        <path
          d={d}
          fill="none"
          stroke={color}
          strokeWidth={2}
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        {parsed.map((p, i) => {
          const cx = xScale(i, count);
          const cy = yScale(p.value);
          return (
            <g
              key={i}
              onMouseEnter={() => setHover({ key, index: i })}
              onMouseLeave={() => setHover((prev) => (prev?.key === key && prev?.index === i ? null : prev))}
            >
              <circle cx={cx} cy={cy} r={8} fill="transparent" stroke="transparent" />
            </g>
          );
        })}
      </g>
    );
  };

  const hovered = hover && (hover.key === "solar" ? solarParsed[hover.index] : windParsed[hover.index]);

  return (
    <div className="chart-container">
      {(series.solar?.length || series.wind?.length) && (
        <div className="chart-legend">
          {series.solar?.length ? (
            <span style={{ display: "flex", alignItems: "center", color: "#22d3a5" }}>
              <span className="legend-dot" style={{ background: "#22d3a5", boxShadow: "0 0 6px rgba(34,211,165,0.6)" }} />
              {labels?.solar ?? "Solar"}
            </span>
          ) : null}
          {series.wind?.length ? (
            <span style={{ display: "flex", alignItems: "center", color: "#60a5fa" }}>
              <span className="legend-dot" style={{ background: "#60a5fa", boxShadow: "0 0 6px rgba(96,165,250,0.6)" }} />
              {labels?.wind ?? "Wind"}
            </span>
          ) : null}
        </div>
      )}

      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="chart-svg"
      >
        <defs>
          <linearGradient id="fillSolar" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#22d3a5" stopOpacity="0.4" />
            <stop offset="100%" stopColor="#22d3a5" stopOpacity="0" />
          </linearGradient>
          <linearGradient id="fillWind" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#60a5fa" stopOpacity="0.35" />
            <stop offset="100%" stopColor="#60a5fa" stopOpacity="0" />
          </linearGradient>
          <filter id="glow">
            <feGaussianBlur stdDeviation="2" result="blur" />
            <feComposite in="SourceGraphic" in2="blur" operator="over" />
          </filter>
        </defs>

        {/* Y grid lines */}
        {yTicks.map((t, idx) => (
          <g key={idx}>
            <line
              x1={padding} x2={width - padding}
              y1={t.y} y2={t.y}
              stroke="rgba(99,135,220,0.12)"
              strokeDasharray="4 8"
            />
            <text
              x={padding - 8} y={t.y + 4}
              textAnchor="end"
              fill="#4b5b7a"
              fontSize={9.5}
              fontFamily="'JetBrains Mono', monospace"
            >
              {t.v.toFixed(1)}
            </text>
          </g>
        ))}

        {/* X ticks */}
        {xTicks.map((t) => (
          <g key={t.idx}>
            <line
              x1={t.x} x2={t.x}
              y1={padding} y2={height - padding}
              stroke="rgba(99,135,220,0.08)"
              strokeDasharray="4 8"
            />
            <text
              x={t.x} y={height - padding + 16}
              textAnchor="middle"
              fill="#4b5b7a"
              fontSize={8.5}
              fontFamily="'JetBrains Mono', monospace"
            >
              {t.label}
            </text>
          </g>
        ))}

        {renderLine("solar", solarParsed, "#22d3a5", "fillSolar")}
        {renderLine("wind", windParsed, "#60a5fa", "fillWind")}

        {hover && hovered && (() => {
          const count = hover.key === "solar" ? solarParsed.length : windParsed.length;
          const cx = xScale(hover.index, count);
          const cy = yScale(hovered.value);
          const tooltipW = 220;
          const tooltipH = 60;
          const tx = Math.min(Math.max(cx + 14, padding), width - padding - tooltipW);
          const ty = Math.max(cy - tooltipH - 12, padding);
          const label =
            hover.key === "solar"
              ? tooltipLabels?.solar ?? labels?.solar ?? "Solar"
              : tooltipLabels?.wind ?? labels?.wind ?? "Wind";
          const dotColor = hover.key === "solar" ? "#22d3a5" : "#60a5fa";
          const valueUnit = unit === undefined ? "kWh" : unit;
          return (
            <>
              <line x1={cx} x2={cx} y1={padding} y2={height - padding} stroke={dotColor} strokeOpacity={0.3} strokeDasharray="4 4" />
              <circle cx={cx} cy={cy} r={5} fill={dotColor} stroke="#eef2ff" strokeWidth={1.5} filter="url(#glow)" />
              <rect x={tx} y={ty} width={tooltipW} height={tooltipH} rx={10} ry={10}
                fill="rgba(6,9,22,0.97)" stroke="rgba(99,135,220,0.5)" strokeWidth={1}
              />
              <text x={tx + 12} y={ty + 20} fill="#94a3b8" fontSize={10} fontFamily="'JetBrains Mono', monospace">
                {hovered.date.toLocaleString(undefined, {
                  year: "numeric", month: "2-digit", day: "2-digit",
                  hour: "2-digit", minute: "2-digit"
                })}
              </text>
              <text x={tx + 12} y={ty + 40} fill={dotColor} fontSize={12} fontWeight="600" fontFamily="'JetBrains Mono', monospace">
                {label}: {hovered.value.toFixed(3)}{valueUnit ? ` ${valueUnit}` : ""}
              </text>
            </>
          );
        })()}
      </svg>
    </div>
  );
}

// ── Stats ─────────────────────────────────────────────────────────────────────

function Stats({ stats, accent }: {
  stats: { min: number | null; max: number | null; avg: number | null };
  accent?: string;
}) {
  if (stats.min == null || stats.max == null || stats.avg == null) return null;

  const items = [
    { label: "Min", value: stats.min.toFixed(2), icon: "↓" },
    { label: "Avg", value: stats.avg.toFixed(2), icon: "◈" },
    { label: "Max", value: stats.max.toFixed(2), icon: "↑" }
  ];

  return (
    <div className="stats-grid">
      {items.map((item) => (
        <div key={item.label} className="stat-card">
          <div className="stat-icon" style={{ color: accent || "var(--green)" }}>{item.icon}</div>
          <div className="stat-label">{item.label}</div>
          <div className="stat-value">{item.value}</div>
        </div>
      ))}
    </div>
  );
}

// ── Data Table ────────────────────────────────────────────────────────────────

function DataTable({ points, label }: { points: Point[]; label?: string }) {
  const slice = points.slice(0, 50);
  if (!slice.length) return null;

  return (
    <div className="data-table-wrap">
      <div className="data-table-header">
        <span>Date / Time</span>
        <span>{label ? `${label} ` : ""}Production (kWh)</span>
      </div>
      <div className="data-table-body">
        {slice.map((p, idx) => {
          const d = new Date(p.date);
          return (
            <div key={idx} className={`data-table-row ${idx % 2 === 0 ? "even" : "odd"}`}>
              <span className="data-table-date">
                {d.toLocaleString(undefined, {
                  year: "numeric", month: "2-digit", day: "2-digit",
                  hour: "2-digit", minute: "2-digit"
                })}
              </span>
              <span className="data-table-val">{p.value.toFixed(3)}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Filter helpers ────────────────────────────────────────────────────────────

function filterPoints(
  points: Point[],
  opts: { dataset: Dataset; year: number | null; month: number | null; day: number | null; kind: "solar" | "wind" | "wind_raw" }
): Point[] {
  return points.filter((p) => {
    const d = new Date(p.date);
    if (opts.kind === "wind_raw" && opts.year != null && d.getFullYear() !== opts.year) return false;
    if (opts.month != null && d.getMonth() + 1 !== opts.month) return false;
    if (opts.day != null && d.getDate() !== opts.day) return false;
    return true;
  });
}

// ── Select control ────────────────────────────────────────────────────────────

function ControlSelect({
  label,
  value,
  onChange,
  children
}: {
  label: string;
  value: string | number;
  onChange: (v: string) => void;
  children: React.ReactNode;
}) {
  return (
    <label className="control-label">
      {label}
      <select
        className="control-select"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        {children}
      </select>
    </label>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function Page() {
  const [view, setView] = useState<"timeseries" | "optimization">("timeseries");
  const [dataset, setDataset] = useState<Dataset>("solar");
  const [year, setYear] = useState<number | null>(null);
  const [month, setMonth] = useState<number | null>(null);
  const [day, setDay] = useState<number | null>(null);
  const [solarScale, setSolarScale] = useState<number>(1);
  const [windScale, setWindScale] = useState<number>(1);

  const solarRes = useTimeSeries("solar", null);
  const windRes = useTimeSeries("wind", null);
  const windRawRes = useTimeSeries("wind_raw", year);

  const solarData = solarRes.data;
  const windData  = windRes.data;
  const windRawData = windRawRes.data;

  const loading =
    dataset === "both"     ? solarRes.loading || windRes.loading
    : dataset === "solar"  ? solarRes.loading
    : dataset === "wind"   ? windRes.loading
    : windRawRes.loading;

  const error =
    dataset === "both"     ? solarRes.error || windRes.error
    : dataset === "solar"  ? solarRes.error
    : dataset === "wind"   ? windRes.error
    : windRawRes.error;

  const parsedSolar = useMemo(() =>
    filterPoints(solarData?.points ?? [], { dataset, year, month, day, kind: "solar" }),
    [solarData, dataset, year, month, day]
  );
  const parsedWind = useMemo(() =>
    filterPoints(
      (dataset === "wind_raw" ? windRawData?.points : windData?.points) ?? [],
      { dataset, year, month, day, kind: dataset === "wind_raw" ? "wind_raw" : "wind" }
    ),
    [windData, windRawData, dataset, year, month, day]
  );

  const scaledSolar = useMemo(() =>
    parsedSolar.map((p) => ({ ...p, value: p.value * solarScale })),
    [parsedSolar, solarScale]
  );
  const scaledWind = useMemo(() =>
    parsedWind.map((p) => ({ ...p, value: p.value * windScale })),
    [parsedWind, windScale]
  );
  const scaledTotal = useMemo(() => {
    const len = Math.min(scaledSolar.length, scaledWind.length);
    const out: Point[] = [];
    for (let i = 0; i < len; i++) {
      out.push({ date: scaledSolar[i].date, value: scaledSolar[i].value + scaledWind[i].value });
    }
    return out;
  }, [scaledSolar, scaledWind]);

  function computeStats(points: Point[]) {
    if (!points.length) return { min: null, max: null, avg: null, count: 0 };
    const values = points.map((p) => p.value);
    const min = Math.min(...values);
    const max = Math.max(...values);
    const avg = values.reduce((a, b) => a + b, 0) / values.length;
    return { min, max, avg, count: points.length };
  }

  const monthOptions = useMemo(() => {
    const set = new Set<number>();
    for (const p of solarData?.points ?? []) set.add(new Date(p.date).getMonth() + 1);
    const windSource = dataset === "wind_raw" ? windRawData?.points ?? [] : windData?.points ?? [];
    for (const p of windSource) {
      const d = new Date(p.date);
      if (dataset === "wind_raw" && year != null && d.getFullYear() !== year) continue;
      set.add(d.getMonth() + 1);
    }
    return Array.from(set).sort((a, b) => a - b);
  }, [solarData, windData, windRawData, dataset, year]);

  const dayOptions = useMemo(() => {
    const set = new Set<number>();
    for (const p of solarData?.points ?? []) {
      const d = new Date(p.date);
      if (month != null && d.getMonth() + 1 !== month) continue;
      set.add(d.getDate());
    }
    const windSource = dataset === "wind_raw" ? windRawData?.points ?? [] : windData?.points ?? [];
    for (const p of windSource) {
      const d = new Date(p.date);
      if (dataset === "wind_raw" && year != null && d.getFullYear() !== year) continue;
      if (month != null && d.getMonth() + 1 !== month) continue;
      set.add(d.getDate());
    }
    return Array.from(set).sort((a, b) => a - b);
  }, [solarData, windData, windRawData, dataset, year, month]);

  useEffect(() => {
    if (month != null && !monthOptions.includes(month)) setMonth(null);
  }, [month, monthOptions]);
  useEffect(() => {
    if (day != null && !dayOptions.includes(day)) setDay(null);
  }, [day, dayOptions]);

  const pointCount =
    dataset === "both"
      ? `${parsedSolar.length.toLocaleString()} solar + ${parsedWind.length.toLocaleString()} wind`
      : `${(dataset === "solar" ? parsedSolar : parsedWind).length.toLocaleString()} pts`;

  return (
    <div className="app">
      {/* ── Header ── */}
      <header className="app-header">
        <div className="header-brand">
          <div className="header-logo">⚡</div>
          <div>
            <h1 className="header-title">Energy Explorer</h1>
            <p className="header-sub">Solar &amp; Wind Time Series Dashboard</p>
          </div>
        </div>

        <nav className="tab-nav">
          {([
            { id: "timeseries",   label: "📈 Time Series" },
            { id: "optimization", label: "⚙ Optimization" }
          ] as { id: typeof view; label: string }[]).map((tab) => (
            <button
              key={tab.id}
              type="button"
              className={`tab-btn ${view === tab.id ? "active" : ""}`}
              onClick={() => setView(tab.id)}
              id={`tab-${tab.id}`}
            >
              {tab.label}
            </button>
          ))}
        </nav>
      </header>

      {/* ── Main ── */}
      <main className="app-main">

        {/* ═══ TIME SERIES VIEW ═══ */}
        {view === "timeseries" && (
          <>
            {/* Controls */}
            <div className="controls-bar">
              <div className="controls-group">
                <ControlSelect
                  label="Dataset"
                  value={dataset}
                  onChange={(v) => setDataset(v as Dataset)}
                >
                  <option value="solar">☀️ Solar (hourly)</option>
                  <option value="wind">🌬️ Wind (typical)</option>
                  <option value="wind_raw">🌀 Wind raw (yearly)</option>
                  <option value="both">⚡ Solar + Wind overlay</option>
                </ControlSelect>

                {dataset === "wind_raw" && (
                  <ControlSelect
                    label="Year"
                    value={year ?? ""}
                    onChange={(v) => setYear(v ? Number(v) : null)}
                  >
                    {(windRawData?.years ?? []).map((y) => (
                      <option key={y} value={y}>{y}</option>
                    ))}
                  </ControlSelect>
                )}

                <ControlSelect
                  label="Month"
                  value={month ?? ""}
                  onChange={(v) => setMonth(v ? Number(v) : null)}
                >
                  <option value="">All</option>
                  {monthOptions.map((m) => (
                    <option key={m} value={m}>{m.toString().padStart(2, "0")}</option>
                  ))}
                </ControlSelect>

                <ControlSelect
                  label="Day"
                  value={day ?? ""}
                  onChange={(v) => setDay(v ? Number(v) : null)}
                >
                  <option value="">All</option>
                  {dayOptions.map((d) => (
                    <option key={d} value={d}>{d.toString().padStart(2, "0")}</option>
                  ))}
                </ControlSelect>
              </div>

              {/* Scale sliders */}
              <div className="controls-group">
                <div className="slider-wrap">
                  <div className="slider-header">
                    <span>Solar scale</span>
                    <span className="slider-val">{solarScale.toFixed(1)}×</span>
                  </div>
                  <input
                    type="range" min={0} max={3} step={0.1}
                    value={solarScale}
                    onChange={(e) => setSolarScale(Number(e.target.value))}
                  />
                </div>
                <div className="slider-wrap">
                  <div className="slider-header">
                    <span>Wind scale</span>
                    <span className="slider-val">{windScale.toFixed(1)}×</span>
                  </div>
                  <input
                    type="range" min={0} max={15} step={0.1}
                    value={windScale}
                    onChange={(e) => setWindScale(Number(e.target.value))}
                  />
                </div>
              </div>

              <div className="controls-spacer" />
              <span className="points-badge">{pointCount}</span>
            </div>

            {/* Chart + Table side-by-side on wide screens */}
            <div style={{ display: "flex", gap: "20px", flexWrap: "wrap" }}>
              {/* Chart panel */}
              <div style={{ flex: "3 1 520px", display: "flex", flexDirection: "column", gap: "16px" }}>
                {loading ? (
                  <div className="state-box loading">
                    <div className="spinner" />
                    <span>Loading {dataset === "both" ? "solar &amp; wind" : dataset} data…</span>
                  </div>
                ) : error ? (
                  <div className="state-box error">
                    <span style={{ fontSize: 24 }}>⚠️</span>
                    <span>Failed to load: {error}</span>
                  </div>
                ) : (
                  <div className="card" style={{ padding: "20px" }}>
                    <Chart
                      series={{
                        solar: dataset === "solar" || dataset === "both" ? scaledSolar : undefined,
                        wind:  dataset === "wind" || dataset === "wind_raw" || dataset === "both" ? scaledWind : undefined
                      }}
                    />
                  </div>
                )}

                {/* Stats */}
                {!loading && !error && (
                  <>
                    {dataset === "solar" && (
                      <Stats stats={computeStats(scaledSolar)} accent="var(--green)" />
                    )}
                    {(dataset === "wind" || dataset === "wind_raw") && (
                      <Stats stats={computeStats(scaledWind)} accent="var(--blue)" />
                    )}
                    {dataset === "both" && (
                      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                        {scaledSolar.length > 0 && (
                          <div>
                            <div className="section-eyebrow" style={{ color: "var(--green)" }}>
                              ☀ Solar
                            </div>
                            <Stats stats={computeStats(scaledSolar)} accent="var(--green)" />
                          </div>
                        )}
                        {scaledWind.length > 0 && (
                          <div>
                            <div className="section-eyebrow" style={{ color: "var(--blue)" }}>
                              🌬 Wind
                            </div>
                            <Stats stats={computeStats(scaledWind)} accent="var(--blue)" />
                          </div>
                        )}
                        {scaledTotal.length > 0 && (
                          <div>
                            <div className="section-eyebrow" style={{ color: "var(--yellow)" }}>
                              ⚡ Combined
                            </div>
                            <Stats stats={computeStats(scaledTotal)} accent="var(--yellow)" />
                          </div>
                        )}
                      </div>
                    )}
                  </>
                )}
              </div>

              {/* Table panel */}
              {!loading && !error && (
                <div style={{ flex: "1 1 260px" }}>
                  <DataTable
                    points={dataset === "wind" || dataset === "wind_raw" ? scaledWind : scaledSolar}
                    label={
                      dataset === "both" ? "Solar"
                      : dataset === "solar" ? "Solar"
                      : "Wind"
                    }
                  />
                </div>
              )}
            </div>
          </>
        )}

        {/* ═══ OPTIMIZATION VIEW ═══ */}
        {view === "optimization" && (
          <div style={{ width: "100%", maxWidth: 1200, margin: "0 auto" }}>
            <OptimizationPanel />
          </div>
        )}
      </main>
    </div>
  );
}

// ── Optimization Panel ────────────────────────────────────────────────────────

function OptimizationPanel() {
  const { status, error, result, runOptimization } = useOptimization();
  const [optMonth, setOptMonth] = useState<number | null>(null);
  const [optDay,   setOptDay]   = useState<number | null>(null);
  const [showLog,  setShowLog]  = useState(false);

  const best = result ? { s: result.bestS, w: result.bestW, b: result.bestB } : null;

  const monthOptions = useMemo(() => {
    if (!result) return [] as number[];
    const set = new Set<number>();
    for (const p of result.series) set.add(new Date(p.date).getMonth() + 1);
    return Array.from(set).sort((a, b) => a - b);
  }, [result]);

  const dayOptions = useMemo(() => {
    if (!result) return [] as number[];
    const set = new Set<number>();
    for (const p of result.series) {
      const d = new Date(p.date);
      if (optMonth != null && d.getMonth() + 1 !== optMonth) continue;
      set.add(d.getDate());
    }
    return Array.from(set).sort((a, b) => a - b);
  }, [result, optMonth]);

  const focusedSeries = useMemo(() => {
    if (!result) return [] as SeriesPoint[];
    return result.series.filter((p: SeriesPoint) => {
      const d = new Date(p.date);
      if (optMonth != null && d.getMonth() + 1 !== optMonth) return false;
      if (optDay   != null && d.getDate()        !== optDay)   return false;
      return true;
    });
  }, [result, optMonth, optDay]);

  const dayStats = useMemo(() => {
    if (!result) return [] as { month: number; day: number; avg: number; errPct: number }[];
    const byDay = new Map<string, { month: number; day: number; avg: number; errPct: number }>();
    for (const p of result.series as SeriesPoint[]) {
      const d = new Date(p.date);
      const month = d.getMonth() + 1;
      const day   = d.getDate();
      if (optMonth != null && month !== optMonth) continue;
      const key = `${month}-${day}`;
      if (!byDay.has(key)) {
        const baseload = p.baseload;
        const avg      = p.dailyAvgProd;
        const errPct   = baseload > 0 ? (avg - baseload) / baseload : 0;
        byDay.set(key, { month, day, avg, errPct });
      }
    }
    return Array.from(byDay.values()).sort((a, b) => a.day - b.day);
  }, [result, optMonth]);

  const intervalStats =
    focusedSeries && focusedSeries.length > 0 && result
      ? (() => {
          const n = focusedSeries.length;
          const avgProd          = focusedSeries.reduce((a, p) => a + p.productionCombined, 0) / n;
          const avgCurt          = focusedSeries.reduce((a, p) => a + p.curtailment,        0) / n;
          const avgShortfallFrac = focusedSeries.reduce((a, p) => {
            const diff = p.baseload - p.productionCombined;
            return a + (p.baseload > 0 ? diff / p.baseload : 0);
          }, 0) / n;
          return { avgProd, avgCurt, avgShortfallFrac };
        })()
      : null;

  return (
    <div className="opt-layout">
      {/* Header card */}
      <div className="opt-header-card">
        <div className="opt-description-block">
          <div className="opt-eyebrow">⚙ Grid Search Optimization</div>
          <h2 className="opt-title">Solar + Wind Capacity Optimizer</h2>
          <p className="opt-desc">
            <strong>Objective:</strong> Grid search over solar (S) and wind (W) capacities
            to maximize baseload at ~10% yearly curtailment.<br />
            <strong>Algorithm:</strong> For each (S, W) pair, compute hourly production, find the
            baseload B yielding ~10% curtailment, then enforce that average daily production ≥ 70% of B
            across the full year. The combination with the highest valid baseload wins.
          </p>
        </div>

        <div className="opt-actions">
          <button
            id="btn-run-optimization"
            type="button"
            className="btn btn-primary"
            onClick={() => runOptimization({ targetCurtailment: 0.1, stepMw: 10 })}
            disabled={status === "running"}
          >
            <span className="btn-icon">{status === "running" ? "⏳" : "▶"}</span>
            {status === "running" ? "Running…" : "Run Optimization"}
          </button>
          {result?.gridSamples?.length && (
            <button
              id="btn-view-log"
              type="button"
              className="btn btn-secondary"
              onClick={() => setShowLog(true)}
            >
              <span className="btn-icon">📋</span>
              View Log ({result.gridSamples.length} combinations)
            </button>
          )}
        </div>
      </div>

      {/* Running state */}
      {status === "running" && (
        <div className="running-banner">
          <div className="spinner" style={{ width: 20, height: 20, borderWidth: 2 }} />
          Running grid search over solar and wind capacities… This may take a few seconds.
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="error-banner">⚠️ Failed to run optimization: {error}</div>
      )}

      {/* Best result cards */}
      {best && (
        <>
          <div className="section-eyebrow">🏆 Best Result</div>
          <div className="stats-grid">
            {[
              { label: "Solar Capacity", value: best.s.toFixed(1), unit: "MW", icon: "☀️" },
              { label: "Wind Capacity",  value: best.w.toFixed(1), unit: "MW", icon: "🌬️" },
              { label: "Baseload",       value: best.b.toFixed(1), unit: "MW", icon: "⚡" }
            ].map((item) => (
              <div key={item.label} className="result-card">
                <div className="result-label">{item.icon} {item.label}</div>
                <div className="result-value">
                  {item.value}
                  <span className="result-unit">{item.unit}</span>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {/* Filter row */}
      {result && (
        <div className="controls-bar" style={{ flexWrap: "wrap", gap: 12 }}>
          <div className="controls-group">
            <label className="control-label">
              Month
              <select
                id="opt-month-select"
                className="control-select"
                value={optMonth ?? ""}
                onChange={(e) => setOptMonth(e.target.value ? Number(e.target.value) : null)}
              >
                <option value="">All</option>
                {monthOptions.map((m) => (
                  <option key={m} value={m}>{m.toString().padStart(2, "0")}</option>
                ))}
              </select>
            </label>
            <label className="control-label">
              Day
              <select
                id="opt-day-select"
                className="control-select"
                value={optDay ?? ""}
                onChange={(e) => setOptDay(e.target.value ? Number(e.target.value) : null)}
              >
                <option value="">All</option>
                {dayOptions.map((d) => (
                  <option key={d} value={d}>{d.toString().padStart(2, "0")}</option>
                ))}
              </select>
            </label>
          </div>

          {dayStats.length > 0 && (
            <div style={{ flex: 1, minWidth: 200 }}>
              <div className="section-eyebrow" style={{ marginBottom: 6 }}>Daily breakdown</div>
              <div className="day-stats-list">
                {dayStats.map((s) => (
                  <div key={`${s.month}-${s.day}`} className="day-stat-row">
                    <span className="day-stat-lbl">Day {s.day.toString().padStart(2, "0")}</span>
                    <span className="day-stat-val">{s.avg.toFixed(1)} MW</span>
                    <span className={`day-stat-err ${s.errPct >= 0 ? "positive" : "negative"}`}>
                      {(s.errPct * 100).toFixed(1)}%
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Interval stats */}
      {intervalStats && (
        <>
          <div className="section-eyebrow">📊 Focused Interval Stats</div>
          <div className="stats-grid">
            {[
              { label: "Avg Combined Production", value: `${intervalStats.avgProd.toFixed(2)} MW`, icon: "⚡" },
              { label: "Avg Curtailment",          value: `${intervalStats.avgCurt.toFixed(2)} MW`, icon: "✂️" },
              { label: "Avg Shortfall vs Baseload",value: `${(intervalStats.avgShortfallFrac * 100).toFixed(1)}%`, icon: "📉" }
            ].map((item) => (
              <div key={item.label} className="stat-card" style={{ background: "rgba(37, 99, 235, 0.08)" }}>
                <div className="stat-icon">{item.icon}</div>
                <div className="stat-label">{item.label}</div>
                <div className="stat-value" style={{ fontSize: 18 }}>{item.value}</div>
              </div>
            ))}
          </div>
        </>
      )}

      {/* Production chart */}
      {focusedSeries?.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div className="section-eyebrow">📈 Combined Production vs Baseload</div>
          <div className="card" style={{ padding: "20px" }}>
            <Chart
              series={{
                solar: focusedSeries.map((p) => ({ date: p.date, value: p.productionCombined })),
                wind:  focusedSeries.map((p) => ({ date: p.date, value: p.baseload }))
              }}
              labels={{ solar: "Combined production", wind: "Baseload" }}
              unit="MW"
            />
          </div>

          <div className="two-col">
            <div>
              <div className="section-eyebrow">✂️ Curtailment above Baseload</div>
              <div className="card" style={{ padding: "20px" }}>
                <Chart
                  series={{ solar: focusedSeries.map((p) => ({ date: p.date, value: p.curtailment })) }}
                  labels={{ solar: "Curtailment" }}
                  unit="MW"
                />
              </div>
            </div>
            <div>
              <div className="section-eyebrow">📉 Shortfall vs Baseload</div>
              <div className="card" style={{ padding: "20px" }}>
                <Chart
                  series={{
                    solar: focusedSeries.map((p) => {
                      const diff = p.baseload - p.productionCombined;
                      return { date: p.date, value: p.baseload > 0 ? diff / p.baseload : 0 };
                    })
                  }}
                  labels={{ solar: "Shortfall fraction" }}
                  unit=""
                />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Log modal */}
      {showLog && result?.gridSamples && (
        <div className="modal-backdrop" onClick={() => setShowLog(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div>
                <h3 className="modal-title">📋 Optimization Log</h3>
                <p className="modal-sub">
                  {result.gridSamples.length} combinations tested — best row highlighted in green
                </p>
              </div>
              <button
                id="btn-close-log"
                type="button"
                className="btn btn-secondary"
                onClick={() => setShowLog(false)}
                style={{ padding: "6px 14px" }}
              >
                ✕ Close
              </button>
            </div>
            <div className="modal-body">
              <table className="opt-table">
                <thead>
                  <tr>
                    {["S (MW)", "W (MW)", "Baseload (MW)", "Daily avg prod (MW)", "Daily error vs B (%)"].map((h) => (
                      <th key={h}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {result.gridSamples.map((s, idx) => {
                    const isBest = s.sMw === result.bestS && s.wMw === result.bestW;
                    return (
                      <tr key={idx} className={isBest ? "best" : ""}>
                        <td>{s.sMw.toFixed(1)}</td>
                        <td>{s.wMw.toFixed(1)}</td>
                        <td>{s.baseloadMw.toFixed(2)}</td>
                        <td>{s.dailyAvgProductionMw != null ? s.dailyAvgProductionMw.toFixed(2) : "—"}</td>
                        <td>{s.dailyErrorPct != null ? (s.dailyErrorPct * 100).toFixed(2) : "—"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
