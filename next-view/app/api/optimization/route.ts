import { NextResponse } from "next/server";
import path from "path";
import { promises as fs } from "fs";

type OptimizationParams = {
  targetCurtailment?: number;
  stepMw?: number;
};

type GridSample = {
  sMw: number;
  wMw: number;
  baseloadMw: number;
};

type SeriesPoint = {
  date: string;
  solarScaled: number;
  windScaled: number;
  productionCombined: number;
  baseload: number;
  curtailment: number;
  curtailmentRatio: number;
};

type OptimizationResult = {
  bestS: number;
  bestW: number;
  bestB: number;
  gridSamples: GridSample[];
  series: SeriesPoint[];
};

function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
      continue;
    }
    if (ch === "," && !inQuotes) {
      out.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  out.push(current);
  return out.map((s) => s.trim());
}

function parseOverallCsv(text: string) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) {
    throw new Error("Overall.csv is empty or missing rows");
  }
  const header = splitCsvLine(lines[0]);
  const cols: Record<string, number> = {};
  header.forEach((name, idx) => {
    cols[name.trim().toLowerCase()] = idx;
  });

  const dateIdx = cols["date"] ?? 0;
  const solarIdx = cols["solar production, kwh"];
  const windIdx = cols["wind production, kwh (avg)"];

  if (solarIdx == null || windIdx == null) {
    throw new Error(
      `Cannot find required columns in Overall.csv. Have: ${header.join(", ")}`
    );
  }

  const dates: Date[] = [];
  const solar: number[] = [];
  const wind: number[] = [];

  for (let i = 1; i < lines.length; i++) {
    const raw = lines[i];
    const parts = splitCsvLine(raw);
    if (parts.length <= Math.max(dateIdx, solarIdx, windIdx)) continue;
    const dateStr = parts[dateIdx];
    const solarStr = parts[solarIdx];
    const windStr = parts[windIdx];
    const d = new Date(dateStr);
    if (Number.isNaN(d.getTime())) continue;
    const s = Number(solarStr);
    const w = Number(windStr);
    if (!Number.isFinite(s) || !Number.isFinite(w)) continue;
    dates.push(d);
    solar.push(s);
    wind.push(w);
  }

  if (!dates.length) {
    throw new Error("No valid rows parsed from Overall.csv");
  }

  return { dates, solar, wind };
}

function computeCurtailmentRatio(
  production: number[],
  baseload: number
): number {
  let curtailed = 0;
  let total = 0;
  for (let i = 0; i < production.length; i++) {
    const p = production[i];
    total += p;
    if (p > baseload) curtailed += p - baseload;
  }
  if (total <= 0) return 0;
  return curtailed / total;
}

function findBaseload(
  production: number[],
  targetCurtailment = 0.1
): number {
  if (!production.length) return 0;
  let maxP = 0;
  for (const p of production) if (p > maxP) maxP = p;
  if (maxP <= 0) return 0;

  let lo = 0;
  let hi = maxP;

  for (let i = 0; i < 100; i++) {
    const mid = 0.5 * (lo + hi);
    const ratio = computeCurtailmentRatio(production, mid);
    if (ratio > targetCurtailment) {
      lo = mid;
    } else {
      hi = mid;
    }
    if (hi - lo < 1e-6) break;
  }

  return 0.5 * (lo + hi);
}

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as OptimizationParams;
    const targetCurtailment =
      typeof body.targetCurtailment === "number"
        ? body.targetCurtailment
        : 0.1;
    const stepMw =
      typeof body.stepMw === "number" && body.stepMw > 0 ? body.stepMw : 10;

    const root = process.cwd();
    const overallPath = path.join(root, "..", "Overall.csv");
    const text = await fs.readFile(overallPath, "utf8");
    const { dates, solar, wind } = parseOverallCsv(text);

    if (!solar.length || !wind.length || solar.length !== wind.length) {
      throw new Error("Solar and wind arrays are empty or mismatched");
    }

    const maxCapacity = 200;
    const S_values: number[] = [];
    const W_values: number[] = [];
    for (let s = 0; s <= maxCapacity; s += stepMw) S_values.push(s);
    for (let w = 0; w <= maxCapacity; w += stepMw) W_values.push(w);

    let bestB = -Infinity;
    let bestS = 0;
    let bestW = 0;

    const gridSamples: GridSample[] = [];
    let counter = 0;

    for (const S of S_values) {
      for (const W of W_values) {
        if (S === 0 && W === 0) continue;
        const P = new Array<number>(solar.length);
        for (let i = 0; i < solar.length; i++) {
          P[i] = S * solar[i] + W * wind[i];
        }
        const B = findBaseload(P, targetCurtailment);
        if (B > bestB) {
          bestB = B;
          bestS = S;
          bestW = W;
        }
        if (counter % 10 === 0) {
          gridSamples.push({ sMw: S, wMw: W, baseloadMw: B });
        }
        counter++;
      }
    }

    if (!Number.isFinite(bestB) || bestB <= 0) {
      throw new Error("Could not find valid baseload solution");
    }

    const series: SeriesPoint[] = [];
    for (let i = 0; i < solar.length; i++) {
      const solarScaled = bestS * solar[i];
      const windScaled = bestW * wind[i];
      const productionCombined = solarScaled + windScaled;
      const baseload = bestB;
      const curtailment = Math.max(productionCombined - baseload, 0);
      const ratio =
        productionCombined > 0 ? curtailment / productionCombined : 0;

      series.push({
        date: dates[i].toISOString(),
        solarScaled: Number(solarScaled.toFixed(2)),
        windScaled: Number(windScaled.toFixed(2)),
        productionCombined: Number(productionCombined.toFixed(2)),
        baseload: Number(baseload.toFixed(2)),
        curtailment: Number(curtailment.toFixed(2)),
        curtailmentRatio: Number(ratio.toFixed(4))
      });
    }

    const result: OptimizationResult = {
      bestS,
      bestW,
      bestB,
      gridSamples,
      series
    };

    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json(
      { error: String(e) },
      {
        status: 500
      }
    );
  }
}

