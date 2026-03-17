import React, {
  useEffect,
  useMemo,
  useState,
} from "https://esm.sh/react@18.2.0";
import { createRoot } from "https://esm.sh/react-dom@18.2.0/client";

function parseDateTime(value) {
  if (!value) return null;
  const [d, m, rest] = value.split("/");
  if (!rest) return null;
  const [y, time] = rest.split(" ");
  const [hh = "00", mm = "00"] = (time || "00:00").split(":");
  const year = Number(y);
  const month = Number(m) - 1;
  const day = Number(d);
  const hour = Number(hh);
  const minute = Number(mm);
  if (
    !Number.isFinite(year) ||
    !Number.isFinite(month) ||
    !Number.isFinite(day)
  ) {
    return null;
  }
  return new Date(year, month, day, hour, minute);
}

function parseSolarCsv(text) {
  const lines = text.split(/\r?\n/);
  // First 3 lines are meta + header
  const dataLines = lines.slice(3);
  const out = [];
  for (const raw of dataLines) {
    const line = raw.trim();
    if (!line) continue;
    const [dateStr, valueStr] = line.split(",");
    const date = parseDateTime(dateStr);
    const value = parseFloat(valueStr);
    if (!date || !Number.isFinite(value)) continue;
    out.push({ date, value });
  }
  return out;
}

function parseWindCsv(text) {
  const lines = text.split(/\r?\n/);
  const dataLines = lines.slice(1); // skip header
  const out = [];
  for (const raw of dataLines) {
    const line = raw.trim();
    if (!line) continue;
    const [dateStr, valueStr] = line.split(",");
    const date = parseDateTime(dateStr.replace(/"/g, ""));
    const value = parseFloat(valueStr);
    if (!date || !Number.isFinite(value)) continue;
    out.push({ date, value });
  }
  return out;
}

function useTimeSeries(dataset) {
  const [points, setPoints] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    async function run() {
      try {
        setLoading(true);
        setError(null);
        setPoints([]);
        const file = dataset === "solar" ? "Solar.CSV" : "Wind.csv";
        const res = await fetch(`/${file}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const text = await res.text();
        const parsed =
          dataset === "solar" ? parseSolarCsv(text) : parseWindCsv(text);
        if (!cancelled) {
          setPoints(parsed);
        }
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
  }, [dataset]);

  const years = useMemo(() => {
    const set = new Set();
    for (const p of points) set.add(p.date.getFullYear());
    return Array.from(set).sort((a, b) => a - b);
  }, [points]);

  return { points, years, loading, error };
}

function Chart({ points }) {
  const width = 900;
  const height = 260;
  const padding = 32;

  if (!points.length) {
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
          fontSize: 13,
        }}
      >
        No data for this selection.
      </div>
    );
  }

  const minY = Math.min(...points.map((p) => p.value));
  const maxY = Math.max(...points.map((p) => p.value));
  const count = points.length;
  const spanY = maxY - minY || 1;

  const xScale = (i) =>
    padding + ((width - padding * 2) * i) / Math.max(1, count - 1);
  const yScale = (v) =>
    height - padding - ((height - padding * 2) * (v - minY)) / spanY;

  const d = points
    .map((p, i) => `${i === 0 ? "M" : "L"} ${xScale(i)} ${yScale(p.value)}`)
    .join(" ");

  const ticks = 4;
  const yTicks = Array.from({ length: ticks + 1 }, (_, i) => {
    const t = i / ticks;
    const v = minY + spanY * t;
    return { v, y: yScale(v) };
  });

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      style={{
        width: "100%",
        maxWidth: width,
        borderRadius: 16,
        border: "1px solid rgba(148,163,184,0.4)",
        background:
          "radial-gradient(circle at top left, rgba(59,130,246,0.25), #020617 60%)",
        boxShadow: "0 18px 45px rgba(15,23,42,0.9)",
      }}
    >
      <defs>
        <linearGradient id="line" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#22c55e" />
          <stop offset="50%" stopColor="#eab308" />
          <stop offset="100%" stopColor="#ef4444" />
        </linearGradient>
        <linearGradient id="fill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="rgba(56,189,248,0.4)" />
          <stop offset="100%" stopColor="rgba(15,23,42,0.05)" />
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

      <path
        d={`${d} L ${xScale(points.length - 1)} ${height - padding} L ${xScale(
          0
        )} ${height - padding} Z`}
        fill="url(#fill)"
        fillOpacity={0.9}
      />
      <path
        d={d}
        fill="none"
        stroke="url(#line)"
        strokeWidth={2.1}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}

function Stats({ points }) {
  if (!points.length) return null;
  const values = points.map((p) => p.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const sum = values.reduce((a, b) => a + b, 0);
  const avg = sum / values.length;

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
        gap: 12,
      }}
    >
      {[
        { label: "Min", value: min.toFixed(2) },
        { label: "Max", value: max.toFixed(2) },
        { label: "Average", value: avg.toFixed(2) },
      ].map((item) => (
        <div
          key={item.label}
          style={{
            padding: "10px 12px",
            borderRadius: 12,
            border: "1px solid rgba(148,163,184,0.4)",
            background:
              "linear-gradient(135deg, rgba(15,23,42,0.9), rgba(30,64,175,0.35))",
          }}
        >
          <div
            style={{ fontSize: 11, textTransform: "uppercase", color: "#9ca3af" }}
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

function DataTable({ points }) {
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
        fontSize: 12,
      }}
    >
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "2fr 1fr",
          background:
            "linear-gradient(90deg, rgba(30,64,175,0.8), rgba(59,130,246,0.6))",
          fontWeight: 600,
          padding: "8px 12px",
        }}
      >
        <div>Date / Time</div>
        <div style={{ textAlign: "right" }}>Production (kWh)</div>
      </div>
      <div style={{ maxHeight: 260, overflow: "auto" }}>
        {slice.map((p, idx) => (
          <div
            key={idx}
            style={{
              display: "grid",
              gridTemplateColumns: "2fr 1fr",
              padding: "6px 12px",
              background: idx % 2 ? "rgba(15,23,42,0.95)" : "rgba(15,23,42,0.8)",
            }}
          >
            <div>
              {p.date.toLocaleString(undefined, {
                year: "numeric",
                month: "2-digit",
                day: "2-digit",
                hour: "2-digit",
                minute: "2-digit",
              })}
            </div>
            <div style={{ textAlign: "right" }}>{p.value.toFixed(3)}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function App() {
  const [dataset, setDataset] = useState("solar");
  const [year, setYear] = useState(null);
  const { points, years, loading, error } = useTimeSeries(dataset);

  useEffect(() => {
    if (!years.length) return;
    if (!year || !years.includes(year)) {
      setYear(dataset === "solar" && years.includes(1990) ? 1990 : years[0]);
    }
  }, [years, dataset]);

  const filtered = useMemo(
    () => (year ? points.filter((p) => p.date.getFullYear() === year) : points),
    [points, year]
  );

  return (
    <>
      <header>
        <h1>Solar &amp; Wind Explorer</h1>
        <p>
          Interactive view of your <code>Solar.CSV</code> and{" "}
          <code>Wind.csv</code> time series.
        </p>
      </header>
      <main>
        <section
          style={{
            flex: 3,
            display: "flex",
            flexDirection: "column",
            gap: 12,
          }}
        >
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: 12,
              alignItems: "center",
              justifyContent: "space-between",
            }}
          >
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <label
                style={{
                  fontSize: 12,
                  textTransform: "uppercase",
                  letterSpacing: 0.08,
                  color: "#9ca3af",
                }}
              >
                Dataset
                <select
                  value={dataset}
                  onChange={(e) => setDataset(e.target.value)}
                  style={{
                    marginLeft: 8,
                    padding: "6px 10px",
                    borderRadius: 999,
                    border: "1px solid rgba(148,163,184,0.6)",
                    background: "#020617",
                    color: "#e5e7eb",
                    fontSize: 13,
                  }}
                >
                  <option value="solar">Solar (hourly)</option>
                  <option value="wind">Wind (daily)</option>
                </select>
              </label>
              <label
                style={{
                  fontSize: 12,
                  textTransform: "uppercase",
                  letterSpacing: 0.08,
                  color: "#9ca3af",
                }}
              >
                Year
                <select
                  value={year ?? ""}
                  onChange={(e) => setYear(Number(e.target.value))}
                  style={{
                    marginLeft: 8,
                    padding: "6px 10px",
                    borderRadius: 999,
                    border: "1px solid rgba(148,163,184,0.6)",
                    background: "#020617",
                    color: "#e5e7eb",
                    fontSize: 13,
                  }}
                >
                  {years.map((y) => (
                    <option key={y} value={y}>
                      {y}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div style={{ fontSize: 11, color: "#9ca3af" }}>
              Showing {filtered.length.toLocaleString()} points
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
                color: "#9ca3af",
              }}
            >
              Loading {dataset} data…
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
                color: "#fecaca",
              }}
            >
              Failed to load data: {error}
            </div>
          ) : (
            <Chart points={filtered} />
          )}

          <Stats points={filtered} />
        </section>

        <section style={{ flex: 2 }}>
          <DataTable points={filtered} />
        </section>
      </main>
    </>
  );
}

const root = createRoot(document.getElementById("root"));
root.render(<App />);

