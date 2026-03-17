"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useOptimization, SeriesPoint } from "./hooks/useOptimization";

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
        if (dataset === "wind_raw" && year != null) {
          params.set("year", String(year));
        }
        const res = await fetch(`/api/data?${params.toString()}`);
        const json = (await res.json()) as ApiResponse;
        if (!res.ok || json.error) {
          throw new Error(json.error || `HTTP ${res.status}`);
        }
        if (!cancelled) setData(json);
      } catch (e) {
        if (!cancelled) setError(String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    run();
    return () => {
      cancelled = true;
    };
  }, [dataset, year]);

  return { data, loading, error };
}


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
  const [hover, setHover] = useState<{
    key: "solar" | "wind";
    index: number;
  } | null>(null);

  const solarParsed = useMemo(
    () =>
      (series.solar ?? []).map((p) => ({
        date: new Date(p.date),
        value: p.value
      })),
    [series.solar]
  );
  const windParsed = useMemo(
    () =>
      (series.wind ?? []).map((p) => ({
        date: new Date(p.date),
        value: p.value
      })),
    [series.wind]
  );

  const allValues = useMemo(
    () => [
      ...solarParsed.map((p) => p.value),
      ...windParsed.map((p) => p.value)
    ],
    [solarParsed, windParsed]
  );
  const minY = allValues.length ? Math.min(...allValues) : 0;
  const maxY = allValues.length ? Math.max(...allValues) : 1;
  const spanY = maxY - minY || 1;

  const maxCount = Math.max(solarParsed.length, windParsed.length, 1);
  const width = 900;
  const height = 260;
  const padding = 40;
  const rightExtraFraction = 0.1;

  const xScale = (i: number, count: number) =>
    padding +
    ((width - padding * 2) * i) /
      Math.max(1, (count - 1) * (1 + rightExtraFraction));
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
      <div
        style={{
          flex: 1,
          minHeight: 260,
          borderRadius: 16,
          border: "1px solid rgba(148,163,184,0.4)",
          background:
            "radial-gradient(circle at top, rgba(30,64,175,0.3), #020617 65%)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "#9ca3af",
          fontSize: 13
        }}
      >
        No data for this selection.
      </div>
    );
  }

  const xTickIndices = refParsed.length
    ? Array.from({ length: 5 }, (_, i) =>
        Math.round(((refParsed.length - 1) * i) / 4)
      )
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

  const renderLine = (
    key: "solar" | "wind",
    parsed: SeriesEntry[],
    color: string
  ) => {
    if (!parsed.length) return null;
    const count = parsed.length;
    const d = parsed
      .map((p, i) =>
        i === 0 ? `M ${xScale(i, count)} ${yScale(p.value)}` : `L ${xScale(i, count)} ${yScale(p.value)}`
      )
      .join(" ");
    return (
      <g key={key}>
        <path
          d={d}
          fill="none"
          stroke={color}
          strokeWidth={2.1}
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
              onMouseLeave={() =>
                setHover((prev) => (prev?.key === key && prev?.index === i ? null : prev))
              }
            >
              <circle cx={cx} cy={cy} r={6} fill="transparent" stroke="transparent" />
            </g>
          );
        })}
      </g>
    );
  };

  const hovered =
    hover &&
    (hover.key === "solar"
      ? solarParsed[hover.index]
      : windParsed[hover.index]);

  return (
    <div>
      {(series.solar?.length || series.wind?.length) && (
        <div style={{ display: "flex", gap: 16, marginBottom: 8, fontSize: 12 }}>
          {series.solar?.length ? (
            <span style={{ color: "#22c55e" }}>
              ● {labels?.solar ?? "Solar"}
            </span>
          ) : null}
          {series.wind?.length ? (
            <span style={{ color: "#3b82f6" }}>
              ● {labels?.wind ?? "Wind"}
            </span>
          ) : null}
        </div>
      )}
      <svg
        viewBox={`0 0 ${width} ${height}`}
        style={{
          width: "100%",
          maxWidth: width,
          borderRadius: 16,
          border: "1px solid rgba(51,65,85,0.9)",
          background:
            "radial-gradient(circle at top left, rgba(30,64,175,0.45), #020617 65%)",
          boxShadow: "0 18px 40px rgba(15,23,42,0.85)"
        }}
      >
        <defs>
          <linearGradient id="fillSolar" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="rgba(34,197,94,0.2)" />
            <stop offset="100%" stopColor="rgba(15,23,42,0.02)" />
          </linearGradient>
          <linearGradient id="fillWind" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="rgba(59,130,246,0.2)" />
            <stop offset="100%" stopColor="rgba(15,23,42,0.02)" />
          </linearGradient>
        </defs>

        {yTicks.map((t, idx) => (
          <g key={idx}>
            <line
              x1={padding}
              x2={width - padding}
              y1={t.y}
              y2={t.y}
              stroke="rgba(148,163,184,0.35)"
              strokeDasharray="4 6"
            />
            <text
              x={padding - 10}
              y={t.y + 4}
              textAnchor="end"
              fill="#9ca3af"
              fontSize={10}
            >
              {t.v.toFixed(1)}
            </text>
          </g>
        ))}

        {xTicks.map((t) => (
          <g key={t.idx}>
            <line
              x1={t.x}
              x2={t.x}
              y1={padding}
              y2={height - padding}
              stroke="rgba(148,163,184,0.25)"
              strokeDasharray="4 6"
            />
            <text
              x={t.x}
              y={height - padding + 18}
              textAnchor="middle"
              fill="#9ca3af"
              fontSize={9}
            >
              {t.label}
            </text>
          </g>
        ))}

        {renderLine("solar", solarParsed, "#22c55e")}
        {renderLine("wind", windParsed, "#3b82f6")}

        {hover && hovered && (() => {
          const count = hover.key === "solar" ? solarParsed.length : windParsed.length;
          const cx = xScale(hover.index, count);
          const cy = yScale(hovered.value);
          const tooltipW = 210;
          const tooltipH = 56;
          const tx = Math.min(Math.max(cx + 10, padding), width - padding - tooltipW);
          const ty = Math.max(cy - tooltipH - 10, padding);
          const label =
            hover.key === "solar"
              ? tooltipLabels?.solar ?? labels?.solar ?? "Solar"
              : tooltipLabels?.wind ?? labels?.wind ?? "Wind";
          const valueUnit = unit === undefined ? "kWh" : unit;
          return (
            <>
              <line x1={cx} x2={cx} y1={padding} y2={height - padding} stroke="rgba(248,250,252,0.35)" strokeDasharray="4 4" />
              <circle cx={cx} cy={cy} r={4} fill={hover.key === "solar" ? "#22c55e" : "#3b82f6"} stroke="#fefce8" strokeWidth={1.4} />
              <rect x={tx} y={ty} width={tooltipW} height={tooltipH} rx={8} ry={8} fill="rgba(15,23,42,0.96)" stroke="rgba(148,163,184,0.9)" strokeWidth={1} />
              <text x={tx + 10} y={ty + 18} fill="#e5e7eb" fontSize={11}>
                {hovered.date.toLocaleString(undefined, {
                  year: "numeric",
                  month: "2-digit",
                  day: "2-digit",
                  hour: "2-digit",
                  minute: "2-digit"
                })}
              </text>
              <text x={tx + 10} y={ty + 34} fill={hover.key === "solar" ? "#22c55e" : "#3b82f6"} fontSize={12}>
                {label}: {hovered.value.toFixed(3)}
                {valueUnit ? ` ${valueUnit}` : ""}
              </text>
            </>
          );
        })()}
      </svg>
    </div>
  );
}

function Stats({
  stats
}: {
  stats: { min: number | null; max: number | null; avg: number | null };
}) {
  if (stats.min == null || stats.max == null || stats.avg == null) return null;

  const items = [
    { label: "Min", value: stats.min.toFixed(2) },
    { label: "Max", value: stats.max.toFixed(2) },
    { label: "Average", value: stats.avg.toFixed(2) }
  ];

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
        gap: 12
      }}
    >
      {items.map((item) => (
        <div
          key={item.label}
          style={{
            padding: "10px 12px",
            borderRadius: 12,
            border: "1px solid rgba(148,163,184,0.4)",
            background:
              "linear-gradient(135deg, rgba(15,23,42,0.9), rgba(30,64,175,0.35))"
          }}
        >
          <div
            style={{
              fontSize: 11,
              textTransform: "uppercase",
              letterSpacing: 0.08,
              color: "#9ca3af"
            }}
          >
            {item.label}
          </div>
          <div style={{ marginTop: 4, fontSize: 18, fontWeight: 600 }}>
            {item.value}
          </div>
        </div>
      ))}
    </div>
  );
}

function DataTable({ points, label }: { points: Point[]; label?: string }) {
  const slice = points.slice(0, 30);
  if (!slice.length) return null;
  return (
    <div
      style={{
        borderRadius: 16,
        border: "1px solid rgba(148,163,184,0.4)",
        background:
          "radial-gradient(circle at top, rgba(15,23,42,0.9), rgba(15,23,42,0.98))",
        overflow: "hidden",
        fontSize: 12
      }}
    >
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "2fr 1fr",
          background:
            "linear-gradient(90deg, rgba(30,64,175,0.8), rgba(59,130,246,0.6))",
          fontWeight: 600,
          padding: "8px 12px"
        }}
      >
        <div>Date / Time</div>
        <div style={{ textAlign: "right" }}>{label ? `${label} ` : ""}Production (kWh)</div>
      </div>
      <div style={{ maxHeight: 260, overflow: "auto" }}>
        {slice.map((p, idx) => {
          const d = new Date(p.date);
          return (
            <div
              key={idx}
              style={{
                display: "grid",
                gridTemplateColumns: "2fr 1fr",
                padding: "6px 12px",
                background:
                  idx % 2 === 1
                    ? "rgba(15,23,42,0.95)"
                    : "rgba(15,23,42,0.8)"
              }}
            >
              <div>
                {d.toLocaleString(undefined, {
                  year: "numeric",
                  month: "2-digit",
                  day: "2-digit",
                  hour: "2-digit",
                  minute: "2-digit"
                })}
              </div>
              <div style={{ textAlign: "right" }}>{p.value.toFixed(3)}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function filterPoints(
  points: Point[],
  opts: { dataset: Dataset; year: number | null; month: number | null; day: number | null; kind: "solar" | "wind" | "wind_raw" }
): Point[] {
  return points.filter((p) => {
    const d = new Date(p.date);
    if (opts.kind === "wind_raw" && opts.year != null && d.getFullYear() !== opts.year) {
      return false;
    }
    if (opts.month != null && d.getMonth() + 1 !== opts.month) return false;
    if (opts.day != null && d.getDate() !== opts.day) return false;
    return true;
  });
}

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
  const windData = windRes.data;
  const windRawData = windRawRes.data;
  const data =
    dataset === "solar"
      ? solarData
      : dataset === "wind"
        ? windData
        : dataset === "wind_raw"
          ? windRawData
          : null;
  const loading =
    dataset === "both"
      ? solarRes.loading || windRes.loading
      : dataset === "solar"
        ? solarRes.loading
        : dataset === "wind"
          ? windRes.loading
          : windRawRes.loading;
  const error =
    dataset === "both"
      ? solarRes.error || windRes.error
      : dataset === "solar"
        ? solarRes.error
        : dataset === "wind"
          ? windRes.error
          : windRawRes.error;

  const parsedSolar = useMemo(
    () =>
      filterPoints(solarData?.points ?? [], {
        dataset,
        year,
        month,
        day,
        kind: "solar"
      }),
    [solarData, dataset, year, month, day]
  );
  const parsedWind = useMemo(
    () =>
      filterPoints(
        (dataset === "wind_raw" ? windRawData?.points : windData?.points) ?? [],
        {
        dataset,
        year,
        month,
        day,
        kind: dataset === "wind_raw" ? "wind_raw" : "wind"
        }
      ),
    [windData, windRawData, dataset, year, month, day]
  );

  const scaledSolar = useMemo(
    () => parsedSolar.map((p) => ({ ...p, value: p.value * solarScale })),
    [parsedSolar, solarScale]
  );
  const scaledWind = useMemo(
    () => parsedWind.map((p) => ({ ...p, value: p.value * windScale })),
    [parsedWind, windScale]
  );

  const scaledTotal = useMemo(() => {
    const len = Math.min(scaledSolar.length, scaledWind.length);
    const out: Point[] = [];
    for (let i = 0; i < len; i++) {
      out.push({
        date: scaledSolar[i].date,
        value: scaledSolar[i].value + scaledWind[i].value
      });
    }
    return out;
  }, [scaledSolar, scaledWind]);

  function computeStats(points: Point[]) {
    if (!points.length) {
      return { min: null, max: null, avg: null, count: 0 };
    }
    const values = points.map((p) => p.value);
    const min = Math.min(...values);
    const max = Math.max(...values);
    const sum = values.reduce((a, b) => a + b, 0);
    const avg = sum / values.length;
    return { min, max, avg, count: points.length };
  }

  const monthOptions = useMemo(() => {
    const set = new Set<number>();
    for (const p of solarData?.points ?? []) {
      set.add(new Date(p.date).getMonth() + 1);
    }
    const windSource =
      dataset === "wind_raw" ? windRawData?.points ?? [] : windData?.points ?? [];
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
    const windSource =
      dataset === "wind_raw" ? windRawData?.points ?? [] : windData?.points ?? [];
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

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column"
      }}
    >
      <header
        style={{
          padding: "16px 24px",
          borderBottom: "1px solid rgba(148,163,184,0.4)",
          background:
            "radial-gradient(circle at top left, #1d4ed8 0, #020617 55%)"
        }}
      >
        <h1
          style={{
            margin: 0,
            fontSize: 20,
            letterSpacing: "0.05em"
          }}
        >
          Solar &amp; Wind Explorer
        </h1>
        <p
          style={{
            margin: "4px 0 0",
            fontSize: 13,
            color: "#cbd5f5"
          }}
        >
          Visualizing your <code>Solar.CSV</code> and <code>Wind.csv</code>{" "}
          time series with Next.js + TypeScript.
        </p>
      </header>

      <main
        style={{
          flex: 1,
          padding: "16px 24px 32px",
          display: "flex",
          flexDirection: "column",
          gap: 16
        }}
      >
        <div
          style={{
            display: "flex",
            gap: 8,
            marginBottom: 12,
            borderBottom: "1px solid rgba(148,163,184,0.35)",
            paddingBottom: 8
          }}
        >
          {[
            { id: "timeseries", label: "Time series" },
            { id: "optimization", label: "Optimization" }
          ].map((tab) => {
            const active = view === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setView(tab.id as typeof view)}
                style={{
                  padding: "6px 12px",
                  borderRadius: 999,
                  border: "1px solid rgba(148,163,184,0.6)",
                  background: active ? "#1d4ed8" : "#020617",
                  color: active ? "#e5e7eb" : "#9ca3af",
                  fontSize: 12,
                  textTransform: "uppercase",
                  letterSpacing: 0.08,
                  cursor: "pointer"
                }}
              >
                {tab.label}
              </button>
            );
          })}
        </div>

        {view === "timeseries" && (
          <section
            style={{
              flex: 3,
              display: "flex",
              flexDirection: "column",
              gap: 12
            }}
          >
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: 12,
              alignItems: "center",
              justifyContent: "space-between"
            }}
          >
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <label
                style={{
                  fontSize: 12,
                  textTransform: "uppercase",
                  letterSpacing: 0.08,
                  color: "#9ca3af"
                }}
              >
                Dataset
                <select
                  value={dataset}
                  onChange={(e) => {
                    const next = e.target.value as Dataset;
                    setDataset(next);
                  }}
                  style={{
                    marginLeft: 8,
                    padding: "6px 10px",
                    borderRadius: 999,
                    border: "1px solid rgba(148,163,184,0.6)",
                    background: "#020617",
                    color: "#e5e7eb",
                    fontSize: 13
                  }}
                >
                  <option value="solar">Solar (hourly)</option>
                  <option value="wind">Wind (typical yearless)</option>
                  <option value="wind_raw">Wind raw (with years)</option>
                  <option value="both">Solar + Wind overlay</option>
                </select>
              </label>
              {dataset === "wind_raw" && (
                <label
                  style={{
                    fontSize: 12,
                    textTransform: "uppercase",
                    letterSpacing: 0.08,
                    color: "#9ca3af"
                  }}
                >
                  Year
                  <select
                    value={year ?? ""}
                    onChange={(e) =>
                      setYear(e.target.value ? Number(e.target.value) : null)
                    }
                    style={{
                      marginLeft: 8,
                      padding: "6px 10px",
                      borderRadius: 999,
                      border: "1px solid rgba(148,163,184,0.6)",
                      background: "#020617",
                      color: "#e5e7eb",
                      fontSize: 13
                    }}
                  >
                    {(windRawData?.years ?? []).map((y) => (
                      <option key={y} value={y}>
                        {y}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <label
                style={{
                  fontSize: 12,
                  textTransform: "uppercase",
                  letterSpacing: 0.08,
                  color: "#9ca3af"
                }}
              >
                Month
                <select
                  value={month ?? ""}
                  onChange={(e) =>
                    setMonth(e.target.value ? Number(e.target.value) : null)
                  }
                  style={{
                    marginLeft: 8,
                    padding: "6px 10px",
                    borderRadius: 999,
                    border: "1px solid rgba(148,163,184,0.6)",
                    background: "#020617",
                    color: "#e5e7eb",
                    fontSize: 13
                  }}
                >
                  <option value="">All</option>
                  {monthOptions.map((m) => (
                    <option key={m} value={m}>
                      {m.toString().padStart(2, "0")}
                    </option>
                  ))}
                </select>
              </label>
              <label
                style={{
                  fontSize: 12,
                  textTransform: "uppercase",
                  letterSpacing: 0.08,
                  color: "#9ca3af"
                }}
              >
                Day
                <select
                  value={day ?? ""}
                  onChange={(e) =>
                    setDay(e.target.value ? Number(e.target.value) : null)
                  }
                  style={{
                    marginLeft: 8,
                    padding: "6px 10px",
                    borderRadius: 999,
                    border: "1px solid rgba(148,163,184,0.6)",
                    background: "#020617",
                    color: "#e5e7eb",
                    fontSize: 13
                  }}
                >
                  <option value="">All</option>
                  {dayOptions.map((d) => (
                    <option key={d} value={d}>
                      {d.toString().padStart(2, "0")}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: 12,
                alignItems: "center"
              }}
            >
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 6,
                  minWidth: 180
                }}
              >
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    fontSize: 11,
                    textTransform: "uppercase",
                    letterSpacing: 0.08,
                    color: "#9ca3af"
                  }}
                >
                  <span>Solar scale</span>
                  <span style={{ color: "#e5e7eb" }}>{solarScale.toFixed(1)}×</span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={3}
                  step={0.1}
                  value={solarScale}
                  onChange={(e) => setSolarScale(Number(e.target.value))}
                  style={{ width: "100%" }}
                />
              </div>
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 6,
                  minWidth: 180
                }}
              >
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    fontSize: 11,
                    textTransform: "uppercase",
                    letterSpacing: 0.08,
                    color: "#9ca3af"
                  }}
                >
                  <span>Wind scale</span>
                  <span style={{ color: "#e5e7eb" }}>{windScale.toFixed(1)}×</span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={15}
                  step={0.1}
                  value={windScale}
                  onChange={(e) => setWindScale(Number(e.target.value))}
                  style={{ width: "100%" }}
                />
              </div>
            </div>
            <div style={{ fontSize: 11, color: "#9ca3af" }}>
              Showing{" "}
              {dataset === "both"
                ? `${parsedSolar.length.toLocaleString()} solar + ${parsedWind.length.toLocaleString()} wind`
                : `${
                    (dataset === "solar" ? parsedSolar : parsedWind).length.toLocaleString()
                  } points`}
            </div>
          </div>

          {loading ? (
            <div
              style={{
                flex: 1,
                minHeight: 260,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                borderRadius: 16,
                border: "1px solid rgba(148,163,184,0.4)",
                background:
                  "radial-gradient(circle at top, rgba(15,23,42,0.9), rgba(15,23,42,0.98))",
                fontSize: 13,
                color: "#9ca3af"
              }}
            >
              Loading {dataset === "both" ? "solar & wind" : dataset} data…
            </div>
          ) : error ? (
            <div
              style={{
                flex: 1,
                minHeight: 260,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                borderRadius: 16,
                border: "1px solid rgba(248,113,113,0.6)",
                background:
                  "radial-gradient(circle at top, rgba(127,29,29,0.7), #020617 70%)",
                fontSize: 13,
                color: "#fecaca"
              }}
            >
              Failed to load data: {error}
            </div>
          ) : (
            <Chart
              series={{
                solar:
                  dataset === "solar" || dataset === "both" ? scaledSolar : undefined,
                wind:
                  dataset === "wind" ||
                  dataset === "wind_raw" ||
                  dataset === "both"
                    ? scaledWind
                    : undefined
              }}
            />
          )}

          {dataset === "solar" && <Stats stats={computeStats(scaledSolar)} />}
          {(dataset === "wind" || dataset === "wind_raw") && (
            <Stats stats={computeStats(scaledWind)} />
          )}
          {dataset === "both" && (
            <div style={{ display: "flex", gap: 24, flexWrap: "wrap" }}>
              {scaledSolar.length > 0 && (
                <div>
                  <div style={{ fontSize: 11, color: "#22c55e", marginBottom: 4 }}>Solar</div>
                  <Stats stats={computeStats(scaledSolar)} />
                </div>
              )}
              {scaledWind.length > 0 && (
                <div>
                  <div style={{ fontSize: 11, color: "#3b82f6", marginBottom: 4 }}>Wind</div>
                  <Stats stats={computeStats(scaledWind)} />
                </div>
              )}
              {scaledTotal.length > 0 && (
                <div>
                  <div style={{ fontSize: 11, color: "#eab308", marginBottom: 4 }}>
                    Solar + Wind
                  </div>
                  <Stats stats={computeStats(scaledTotal)} />
                </div>
              )}
            </div>
          )}
          </section>
        )}

        {view === "timeseries" && (
          <section style={{ flex: 2 }}>
            <DataTable
              points={
                dataset === "wind" || dataset === "wind_raw"
                  ? scaledWind
                  : scaledSolar
              }
              label={
                dataset === "both"
                  ? "Solar (scaled sample)"
                  : dataset === "solar"
                    ? "Solar (scaled)"
                    : "Wind (scaled)"
              }
            />
          </section>
        )}

        {view === "optimization" && (
          <section
            style={{
              flex: 1,
              display: "flex",
              justifyContent: "center"
            }}
          >
            <div style={{ width: "100%", maxWidth: 1200 }}>
              <OptimizationPanel />
            </div>
          </section>
        )}
      </main>
    </div>
  );
}

function OptimizationPanel() {
  const { status, error, result, runOptimization } = useOptimization();

  const [optMonth, setOptMonth] = useState<number | null>(null);
  const [optDay, setOptDay] = useState<number | null>(null);
  const [showLog, setShowLog] = useState(false);

  const best = result
    ? {
        s: result.bestS,
        w: result.bestW,
        b: result.bestB
      }
    : null;

  const monthOptions = useMemo(() => {
    if (!result) return [] as number[];
    const set = new Set<number>();
    for (const p of result.series) {
      const d = new Date(p.date);
      set.add(d.getMonth() + 1);
    }
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
      if (optDay != null && d.getDate() !== optDay) return false;
      return true;
    });
  }, [result, optMonth, optDay]);

  const dayStats = useMemo(() => {
    if (!result)
      return [] as { month: number; day: number; avg: number; errPct: number }[];
    const byDay = new Map<
      string,
      { month: number; day: number; avg: number; errPct: number }
    >();
    for (const p of result.series as SeriesPoint[]) {
      const d = new Date(p.date);
      const month = d.getMonth() + 1;
      const day = d.getDate();
      if (optMonth != null && month !== optMonth) continue;
      const key = `${month}-${day}`;
      if (!byDay.has(key)) {
        const baseload = p.baseload;
        const avg = p.dailyAvgProd;
        const errPct = baseload > 0 ? (avg - baseload) / baseload : 0;
        byDay.set(key, { month, day, avg, errPct });
      }
    }
    return Array.from(byDay.values()).sort((a, b) => a.day - b.day);
  }, [result, optMonth]);

  const intervalStats =
    focusedSeries && focusedSeries.length > 0 && result
      ? (() => {
          const n = focusedSeries.length;
          const sumProd = focusedSeries.reduce(
            (acc, p) => acc + p.productionCombined,
            0
          );
          const sumCurt = focusedSeries.reduce(
            (acc, p) => acc + p.curtailment,
            0
          );
          const sumShortfallFrac = focusedSeries.reduce((acc, p) => {
            const diff = p.baseload - p.productionCombined;
            const frac = p.baseload > 0 ? diff / p.baseload : 0;
            return acc + frac;
          }, 0);
          const avgProd = sumProd / n;
          const avgCurt = sumCurt / n;
          const avgShortfallFrac = sumShortfallFrac / n;
          return {
            avgProd,
            avgCurt,
            avgShortfallFrac
          };
        })()
      : null;

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 12,
        alignItems: "stretch"
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: 12
          }}
        >
          <div>
            <div
              style={{
                fontSize: 12,
                textTransform: "uppercase",
                letterSpacing: 0.08,
                color: "#9ca3af"
              }}
            >
              Optimization
            </div>
            <div style={{ fontSize: 13, maxWidth: 620, lineHeight: 1.4 }}>
              <strong>Question:</strong> Grid search over capacities to maximize baseload at ~10%
              yearly curtailment.
              <br />
              <strong>Assumptions:</strong> the 10% curtailment constraint is enforced on the whole
              year. If we only used this constraint, the algorithm would happily choose very
              peaky solar (high production in the afternoon) and low or no wind, which maximizes
              annual energy but can leave people without power in the morning or at night.
              <br />
              <strong>Why this solves it:</strong> we scan a grid of solar (S) and wind (W)
              capacities, compute the resulting hourly production, and for each pair find the
              baseload B that gives about 10% yearly curtailment. We then require that the average
              daily production is at least 70% of B, so we only keep solutions that can support a
              reasonable fraction of the promised baseload across the full day, and among those
              we pick the one with the highest baseload.
            </div>
          </div>
          <button
            type="button"
            onClick={() => runOptimization({ targetCurtailment: 0.1, stepMw: 10 })}
            disabled={status === "running"}
            style={{
              padding: "8px 14px",
              borderRadius: 999,
              border: "none",
              background:
                status === "running" ? "rgba(148,163,184,0.5)" : "#22c55e",
              color: "#020617",
              fontSize: 13,
              fontWeight: 600,
              cursor: status === "running" ? "default" : "pointer"
            }}
          >
            {status === "running" ? "Running…" : "Run optimization"}
          </button>
          {result && result.gridSamples && result.gridSamples.length > 0 && (
            <button
              type="button"
              onClick={() => setShowLog(true)}
              style={{
                padding: "6px 10px",
                borderRadius: 999,
                border: "1px solid rgba(148,163,184,0.7)",
                background: "#020617",
                color: "#e5e7eb",
                fontSize: 11,
                cursor: "pointer"
              }}
            >
              View optimization log
            </button>
          )}
        </div>

        {result && (
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: 12,
              marginTop: 4
            }}
          >
            <label
              style={{
                fontSize: 11,
                textTransform: "uppercase",
                letterSpacing: 0.08,
                color: "#9ca3af"
              }}
            >
              Month
              <select
                value={optMonth ?? ""}
                onChange={(e) =>
                  setOptMonth(e.target.value ? Number(e.target.value) : null)
                }
                style={{
                  marginLeft: 6,
                  padding: "4px 8px",
                  borderRadius: 999,
                  border: "1px solid rgba(148,163,184,0.6)",
                  background: "#020617",
                  color: "#e5e7eb",
                  fontSize: 11
                }}
              >
                <option value="">All</option>
                {monthOptions.map((m) => (
                  <option key={m} value={m}>
                    {m.toString().padStart(2, "0")}
                  </option>
                ))}
              </select>
            </label>
            <label
              style={{
                fontSize: 11,
                textTransform: "uppercase",
                letterSpacing: 0.08,
                color: "#9ca3af"
              }}
            >
              Day
              <select
                value={optDay ?? ""}
                onChange={(e) =>
                  setOptDay(e.target.value ? Number(e.target.value) : null)
                }
                style={{
                  marginLeft: 6,
                  padding: "4px 8px",
                  borderRadius: 999,
                  border: "1px solid rgba(148,163,184,0.6)",
                  background: "#020617",
                  color: "#e5e7eb",
                  fontSize: 11
                }}
              >
                <option value="">All</option>
                {dayOptions.map((d) => (
                  <option key={d} value={d}>
                    {d.toString().padStart(2, "0")}
                  </option>
                ))}
              </select>
            </label>
            {dayStats.length > 0 && (
              <div
                style={{
                  fontSize: 11,
                  color: "#9ca3af",
                  maxHeight: 80,
                  overflow: "auto",
                  paddingLeft: 4,
                  borderLeft: "1px solid rgba(148,163,184,0.4)"
                }}
              >
                <div
                  style={{
                    textTransform: "uppercase",
                    letterSpacing: 0.08,
                    marginBottom: 2
                  }}
                >
                  Day stats (current month)
                </div>
                {dayStats.map((s) => (
                  <div key={`${s.month}-${s.day}`}>
                    {s.day.toString().padStart(2, "0")}:{" "}
                    {s.avg.toFixed(1)} MW, {(s.errPct * 100).toFixed(1)}%
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {status === "running" && (
          <div
            style={{
              borderRadius: 12,
              padding: "10px 12px",
              border: "1px solid rgba(148,163,184,0.5)",
              background:
                "linear-gradient(135deg, rgba(15,23,42,0.95), rgba(30,64,175,0.45))",
              fontSize: 13,
              color: "#e5e7eb"
            }}
          >
            Running grid search over solar and wind capacities… This may take a few
            seconds.
          </div>
        )}

        {error && (
          <div
            style={{
              borderRadius: 12,
              padding: "10px 12px",
              border: "1px solid rgba(248,113,113,0.7)",
              background:
                "linear-gradient(135deg, rgba(69,10,10,0.95), rgba(127,29,29,0.8))",
              fontSize: 13,
              color: "#fecaca"
            }}
          >
            Failed to run optimization: {error}
          </div>
        )}

        {best && (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
              gap: 12
            }}
          >
            {[
              { label: "Solar capacity (MW)", value: best.s.toFixed(1) },
              { label: "Wind capacity (MW)", value: best.w.toFixed(1) },
              { label: "Baseload (MW)", value: best.b.toFixed(1) }
            ].map((item) => (
              <div
                key={item.label}
                style={{
                  padding: "10px 12px",
                  borderRadius: 12,
                  border: "1px solid rgba(148,163,184,0.4)",
                  background:
                    "linear-gradient(135deg, rgba(15,23,42,0.9), rgba(56,189,248,0.25))"
                }}
              >
                <div
                  style={{
                    fontSize: 11,
                    textTransform: "uppercase",
                    letterSpacing: 0.08,
                    color: "#9ca3af"
                  }}
                >
                  {item.label}
                </div>
                <div style={{ marginTop: 4, fontSize: 18, fontWeight: 600 }}>
                  {item.value}
                </div>
              </div>
            ))}
          </div>
        )}

        {intervalStats && (
          <div
            style={{
              marginTop: 10,
              display: "grid",
              gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
              gap: 12
            }}
          >
            {[
              {
                label: "Avg combined production (focused interval)",
                value: `${intervalStats.avgProd.toFixed(2)} MW`
              },
              {
                label: "Avg curtailment above baseload",
                value: `${intervalStats.avgCurt.toFixed(2)} MW`
              },
              {
                label: "Avg shortfall vs baseload",
                value: `${(intervalStats.avgShortfallFrac * 100).toFixed(1)} % of baseload`
              }
            ].map((item) => (
              <div
                key={item.label}
                style={{
                  padding: "10px 12px",
                  borderRadius: 12,
                  border: "1px solid rgba(148,163,184,0.45)",
                  background:
                    "linear-gradient(135deg, rgba(15,23,42,0.95), rgba(56,189,248,0.28))",
                  fontSize: 12,
                  color: "#e5e7eb"
                }}
              >
                <div
                  style={{
                    fontSize: 11,
                    textTransform: "uppercase",
                    letterSpacing: 0.08,
                    color: "#9ca3af",
                    marginBottom: 2
                  }}
                >
                  {item.label}
                </div>
                <div style={{ fontSize: 16, fontWeight: 600 }}>{item.value}</div>
              </div>
            ))}
          </div>
        )}

        {showLog && result && result.gridSamples && (
          <div
            style={{
              position: "fixed",
              inset: 0,
              backgroundColor: "rgba(15,23,42,0.85)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              zIndex: 50
            }}
          >
            <div
              style={{
                width: "90%",
                maxWidth: 900,
                maxHeight: "80vh",
                borderRadius: 16,
                border: "1px solid rgba(148,163,184,0.7)",
                background:
                  "radial-gradient(circle at top, rgba(15,23,42,0.98), rgba(15,23,42,1))",
                boxShadow: "0 25px 60px rgba(0,0,0,0.8)",
                display: "flex",
                flexDirection: "column"
              }}
            >
              <div
                style={{
                  padding: "10px 14px",
                  borderBottom: "1px solid rgba(148,163,184,0.4)",
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  gap: 8
                }}
              >
                <div>
                  <div
                    style={{
                      fontSize: 11,
                      textTransform: "uppercase",
                      letterSpacing: 0.08,
                      color: "#9ca3af"
                    }}
                  >
                    Optimization log
                  </div>
                  <div style={{ fontSize: 13, color: "#e5e7eb" }}>
                    Tested combinations of solar (S) and wind (W) capacities.
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setShowLog(false)}
                  style={{
                    padding: "4px 10px",
                    borderRadius: 999,
                    border: "1px solid rgba(148,163,184,0.7)",
                    background: "#020617",
                    color: "#e5e7eb",
                    fontSize: 11,
                    cursor: "pointer"
                  }}
                >
                  Close
                </button>
              </div>
              <div
                style={{
                  padding: "6px 14px 10px",
                  overflow: "auto",
                  fontSize: 11
                }}
              >
                <table
                  style={{
                    width: "100%",
                    borderCollapse: "collapse",
                    minWidth: 480
                  }}
                >
                  <thead>
                    <tr>
                      {[
                        "S (MW)",
                        "W (MW)",
                        "Baseload (MW)",
                        "Daily avg prod (MW)",
                        "Daily error vs B (%)"
                      ].map((h) => (
                        <th
                          key={h}
                          style={{
                            position: "sticky",
                            top: 0,
                            zIndex: 1,
                            textAlign: "right",
                            padding: "6px 8px",
                            borderBottom: "1px solid rgba(148,163,184,0.6)",
                            backgroundColor: "rgba(15,23,42,0.98)",
                            color: "#9ca3af",
                            fontWeight: 500,
                            whiteSpace: "nowrap"
                          }}
                        >
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {result.gridSamples.map((s, idx) => (
                      <tr
                        key={idx}
                        style={{
                          backgroundColor:
                            s.sMw === result.bestS && s.wMw === result.bestW
                              ? "rgba(34,197,94,0.15)"
                              : idx % 2 === 0
                                ? "rgba(15,23,42,0.9)"
                                : "rgba(15,23,42,0.8)"
                        }}
                      >
                        <td style={{ textAlign: "right", padding: "4px 8px" }}>
                          {s.sMw.toFixed(1)}
                        </td>
                        <td style={{ textAlign: "right", padding: "4px 8px" }}>
                          {s.wMw.toFixed(1)}
                        </td>
                        <td style={{ textAlign: "right", padding: "4px 8px" }}>
                          {s.baseloadMw.toFixed(2)}
                        </td>
                        <td style={{ textAlign: "right", padding: "4px 8px" }}>
                          {s.dailyAvgProductionMw != null
                            ? s.dailyAvgProductionMw.toFixed(2)
                            : "—"}
                        </td>
                        <td style={{ textAlign: "right", padding: "4px 8px" }}>
                          {s.dailyErrorPct != null
                            ? (s.dailyErrorPct * 100).toFixed(2)
                            : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {focusedSeries && focusedSeries.length > 0 && (
          <>
            <div style={{ marginTop: 8 }}>
              <div
                style={{
                  fontSize: 11,
                  textTransform: "uppercase",
                  letterSpacing: 0.08,
                  color: "#9ca3af",
                  marginBottom: 4
                }}
              >
                Combined production vs baseload (focused interval)
              </div>
              <Chart
                series={{
                  solar: focusedSeries.map((p) => ({
                    date: p.date,
                    value: p.productionCombined
                  })),
                  wind: focusedSeries.map((p) => ({
                    date: p.date,
                    value: p.baseload
                  }))
                }}
                labels={{ solar: "Combined production", wind: "Baseload" }}
                unit="MW"
              />
            </div>

            <div
              style={{
                marginTop: 12,
                display: "grid",
                gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)",
                gap: 12
              }}
            >
              <div>
                <div
                  style={{
                    fontSize: 11,
                    textTransform: "uppercase",
                    letterSpacing: 0.08,
                    color: "#9ca3af",
                    marginBottom: 4
                  }}
                >
                Curtailment above baseload (MW)
                </div>
                <Chart
                  series={{
                    solar: focusedSeries.map((p) => ({
                      date: p.date,
                      value: p.curtailment
                    }))
                  }}
                  labels={{ solar: "Curtailment above baseload" }}
                  unit="MW"
                />
              </div>
              <div>
                <div
                  style={{
                    fontSize: 11,
                    textTransform: "uppercase",
                    letterSpacing: 0.08,
                    color: "#9ca3af",
                    marginBottom: 4
                  }}
                >
                Shortfall vs baseload (fraction of baseload)
                </div>
                <Chart
                  series={{
                    solar: focusedSeries.map((p) => {
                      const diff = p.baseload - p.productionCombined;
                      const frac =
                        p.baseload > 0 ? diff / p.baseload : 0;
                      return {
                        date: p.date,
                        value: frac
                      };
                    })
                  }}
                  labels={{ solar: "Shortfall vs baseload" }}
                  unit=""
                />
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}



