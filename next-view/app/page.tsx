"use client";

import React, { useEffect, useMemo, useState } from "react";

type Dataset = "solar" | "wind" | "both";

type Point = { date: string; value: number };

type ApiResponse = {
  dataset: "solar" | "wind";
  year: number | null;
  years: number[];
  points: Point[];
  stats: { min: number | null; max: number | null; avg: number | null; count: number };
  error?: string;
};

function useTimeSeries(dataset: "solar" | "wind", year: number | null) {
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
        if (dataset === "wind" && year != null) {
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
  series
}: {
  series: { solar?: Point[]; wind?: Point[] };
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

  const xScale = (i: number, count: number) =>
    padding +
    ((width - padding * 2) * i) / Math.max(1, count - 1);
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
            <span style={{ color: "#22c55e" }}>● Solar</span>
          ) : null}
          {series.wind?.length ? (
            <span style={{ color: "#3b82f6" }}>● Wind</span>
          ) : null}
        </div>
      )}
      <svg
        viewBox={`0 0 ${width} ${height}`}
        style={{
          width: "100%",
          maxWidth: width,
          borderRadius: 16,
          border: "1px solid rgba(148,163,184,0.4)",
          background:
            "radial-gradient(circle at top left, rgba(59,130,246,0.25), #020617 60%)",
          boxShadow: "0 18px 45px rgba(15,23,42,0.9)"
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
          const tooltipW = 190;
          const tooltipH = 52;
          const tx = Math.min(Math.max(cx + 10, padding), width - padding - tooltipW);
          const ty = Math.max(cy - tooltipH - 10, padding);
          return (
            <>
              <line x1={cx} x2={cx} y1={padding} y2={height - padding} stroke="rgba(248,250,252,0.35)" strokeDasharray="4 4" />
              <circle cx={cx} cy={cy} r={4} fill={hover.key === "solar" ? "#22c55e" : "#3b82f6"} stroke="#fefce8" strokeWidth={1.4} />
              <rect x={tx} y={ty} width={tooltipW} height={tooltipH} rx={8} ry={8} fill="rgba(15,23,42,0.96)" stroke="rgba(148,163,184,0.9)" strokeWidth={1} />
              <text x={tx + 10} y={ty + 18} fill="#e5e7eb" fontSize={11}>
                {hovered.date.toLocaleString(undefined, { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}
              </text>
              <text x={tx + 10} y={ty + 34} fill={hover.key === "solar" ? "#22c55e" : "#3b82f6"} fontSize={12}>
                {hover.key === "solar" ? "Solar" : "Wind"}: {hovered.value.toFixed(3)} kWh
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
  opts: { dataset: Dataset; year: number | null; month: number | null; day: number | null; isWind: boolean }
): Point[] {
  return points.filter((p) => {
    const d = new Date(p.date);
    if (opts.isWind && opts.year != null && d.getFullYear() !== opts.year) return false;
    if (opts.month != null && d.getMonth() + 1 !== opts.month) return false;
    if (opts.day != null && d.getDate() !== opts.day) return false;
    return true;
  });
}

export default function Page() {
  const [dataset, setDataset] = useState<Dataset>("solar");
  const [year, setYear] = useState<number | null>(null);
  const [month, setMonth] = useState<number | null>(null);
  const [day, setDay] = useState<number | null>(null);

  const solarRes = useTimeSeries("solar", null);
  const windRes = useTimeSeries("wind", year);

  const solarData = solarRes.data;
  const windData = windRes.data;
  const data = dataset === "solar" ? solarData : dataset === "wind" ? windData : null;
  const loading =
    dataset === "both"
      ? solarRes.loading || windRes.loading
      : dataset === "solar"
        ? solarRes.loading
        : windRes.loading;
  const error = dataset === "both" ? solarRes.error || windRes.error : dataset === "solar" ? solarRes.error : windRes.error;

  const years = windData?.years ?? [];

  useEffect(() => {
    if (dataset === "solar") {
      setYear(null);
      return;
    }
    if (dataset === "both" || dataset === "wind") {
      if (!year || !years.includes(year)) {
        const preferred = years.includes(2020) ? 2020 : years[0] ?? null;
        setYear(preferred);
        if (dataset === "wind") {
          setMonth(null);
          setDay(null);
        }
      }
    }
  }, [dataset, year, years]);

  const parsedSolar = useMemo(
    () =>
      filterPoints(solarData?.points ?? [], {
        dataset,
        year,
        month,
        day,
        isWind: false
      }),
    [solarData, dataset, year, month, day]
  );
  const parsedWind = useMemo(
    () =>
      filterPoints(windData?.points ?? [], {
        dataset,
        year,
        month,
        day,
        isWind: true
      }),
    [windData, dataset, year, month, day]
  );

  const monthOptions = useMemo(() => {
    const set = new Set<number>();
    for (const p of solarData?.points ?? []) {
      set.add(new Date(p.date).getMonth() + 1);
    }
    for (const p of windData?.points ?? []) {
      const d = new Date(p.date);
      if (year != null && d.getFullYear() !== year) continue;
      set.add(d.getMonth() + 1);
    }
    return Array.from(set).sort((a, b) => a - b);
  }, [solarData, windData, year]);

  const dayOptions = useMemo(() => {
    const set = new Set<number>();
    for (const p of solarData?.points ?? []) {
      const d = new Date(p.date);
      if (month != null && d.getMonth() + 1 !== month) continue;
      set.add(d.getDate());
    }
    for (const p of windData?.points ?? []) {
      const d = new Date(p.date);
      if (year != null && d.getFullYear() !== year) continue;
      if (month != null && d.getMonth() + 1 !== month) continue;
      set.add(d.getDate());
    }
    return Array.from(set).sort((a, b) => a - b);
  }, [solarData, windData, year, month]);

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
                  <option value="wind">Wind (hourly)</option>
                  <option value="both">Both (overlay)</option>
                </select>
              </label>
              {(dataset === "wind" || dataset === "both") && (
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
                    {(data?.years ?? []).map((y) => (
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
            <div style={{ fontSize: 11, color: "#9ca3af" }}>
              Showing{" "}
              {dataset === "both"
                ? `${parsedSolar.length.toLocaleString()} solar + ${parsedWind.length.toLocaleString()} wind`
                : `${(dataset === "solar" ? parsedSolar : parsedWind).length.toLocaleString()} points`}
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
                solar: dataset === "solar" || dataset === "both" ? parsedSolar : undefined,
                wind: dataset === "wind" || dataset === "both" ? parsedWind : undefined
              }}
            />
          )}

          {dataset === "solar" && solarData && <Stats stats={solarData.stats} />}
          {dataset === "wind" && windData && <Stats stats={windData.stats} />}
          {dataset === "both" && (
            <div style={{ display: "flex", gap: 24, flexWrap: "wrap" }}>
              {solarData && (
                <div>
                  <div style={{ fontSize: 11, color: "#22c55e", marginBottom: 4 }}>Solar</div>
                  <Stats stats={solarData.stats} />
                </div>
              )}
              {windData && (
                <div>
                  <div style={{ fontSize: 11, color: "#3b82f6", marginBottom: 4 }}>Wind</div>
                  <Stats stats={windData.stats} />
                </div>
              )}
            </div>
          )}
        </section>

        <section style={{ flex: 2 }}>
          <DataTable
            points={dataset === "wind" ? parsedWind : parsedSolar}
            label={dataset === "both" ? "Solar (sample)" : undefined}
          />
        </section>
      </main>
    </div>
  );
}

