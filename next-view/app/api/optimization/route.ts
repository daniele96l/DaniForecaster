import { NextResponse } from "next/server";
import path from "path";
import { promises as fs } from "fs";
import { fileURLToPath } from "url";

type OptimizationParams = {
  targetCurtailment?: number;
  stepMw?: number;
};

type GridSample = {
  sMw: number;
  wMw: number;
  baseloadMw: number;
  dailyAvgProductionMw?: number;
  dailyErrorPct?: number;
};

type SeriesPoint = {
  date: string;
  solarScaled: number;
  windScaled: number;
  productionCombined: number;
  baseload: number;
  curtailment: number;
  curtailmentRatio: number;
  hourlyShortfall: number;
  dailyAvgProd: number;
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

function parseOverallWithBaseloadCsv(text: string) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) {
    throw new Error("Overall_with_baseload.csv is empty or missing rows");
  }
  const header = splitCsvLine(lines[0]);
  const cols: Record<string, number> = {};
  header.forEach((name, idx) => {
    cols[name.trim().toLowerCase()] = idx;
  });

  const dateIdx = cols["date"] ?? 0;
  const solarCapIdx = cols["solarcap_mw"];
  const windCapIdx = cols["windcap_mw"];
  const baseloadIdx = cols["baseload_mw"];
  const solarScaledIdx = cols["solarscaled"];
  const windScaledIdx = cols["windscaled"];
  const prodCombinedIdx = cols["prodcombined"];
  const hourlyShortfallIdx = cols["hourlyshortfall"];
  const dailyAvgProdIdx = cols["dailyavgprod"];

  if (
    solarCapIdx == null ||
    windCapIdx == null ||
    baseloadIdx == null ||
    solarScaledIdx == null ||
    windScaledIdx == null ||
    prodCombinedIdx == null ||
    hourlyShortfallIdx == null ||
    dailyAvgProdIdx == null
  ) {
    throw new Error(
      `Cannot find required columns in Overall_with_baseload.csv. Have: ${header.join(", ")}`
    );
  }

  const series: SeriesPoint[] = [];
  let bestS = 0;
  let bestW = 0;
  let bestB = 0;

  for (let i = 1; i < lines.length; i++) {
    const raw = lines[i];
    const parts = splitCsvLine(raw);
    if (parts.length <= Math.max(dateIdx, prodCombinedIdx, baseloadIdx))
      continue;
    const dateStr = parts[dateIdx];
    const d = new Date(dateStr);
    if (Number.isNaN(d.getTime())) continue;

    const solarCap = Number(parts[solarCapIdx]);
    const windCap = Number(parts[windCapIdx]);
    const baseload = Number(parts[baseloadIdx]);
    const solarScaled = Number(parts[solarScaledIdx]);
    const windScaled = Number(parts[windScaledIdx]);
    const productionCombined = Number(parts[prodCombinedIdx]);
    const hourlyShortfall = Number(parts[hourlyShortfallIdx]);
    const dailyAvgProd = Number(parts[dailyAvgProdIdx]);

    if (i === 1) {
      bestS = solarCap;
      bestW = windCap;
      bestB = baseload;
    }

    const curtailment = Math.max(productionCombined - baseload, 0);
    const curtailmentRatio =
      productionCombined > 0 ? curtailment / productionCombined : 0;

    series.push({
      date: d.toISOString(),
      solarScaled: Number(solarScaled.toFixed(2)),
      windScaled: Number(windScaled.toFixed(2)),
      productionCombined: Number(productionCombined.toFixed(2)),
      baseload: Number(baseload.toFixed(2)),
      curtailment: Number(curtailment.toFixed(2)),
      curtailmentRatio: Number(curtailmentRatio.toFixed(4)),
      hourlyShortfall: Number(hourlyShortfall.toFixed(4)),
      dailyAvgProd: Number(dailyAvgProd.toFixed(2))
    });
  }

  if (!series.length) {
    throw new Error("No valid rows parsed from Overall_with_baseload.csv");
  }

  return { bestS, bestW, bestB, series };
}

function parseGridSearchLogCsv(text: string): GridSample[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) return [];

  const header = splitCsvLine(lines[0]);
  const cols: Record<string, number> = {};
  header.forEach((name, idx) => {
    cols[name.trim().toLowerCase()] = idx;
  });

  const sIdx = cols["s_mw"];
  const wIdx = cols["w_mw"];
  const bIdx = cols["baseload_mw"];
  const avgIdx = cols["dailyavgprod_mw"];
  const errIdx = cols["dailyerrorpct"];

  if (sIdx == null || wIdx == null || bIdx == null) {
    return [];
  }

  const samples: GridSample[] = [];
  for (let i = 1; i < lines.length; i++) {
    const parts = splitCsvLine(lines[i]);
    if (parts.length <= Math.max(sIdx, wIdx, bIdx)) continue;
    const sMw = Number(parts[sIdx]);
    const wMw = Number(parts[wIdx]);
    const baseloadMw = Number(parts[bIdx]);
    const dailyAvgProductionMw =
      avgIdx != null && parts[avgIdx] != null ? Number(parts[avgIdx]) : undefined;
    const dailyErrorPct =
      errIdx != null && parts[errIdx] != null ? Number(parts[errIdx]) : undefined;
    samples.push({
      sMw,
      wMw,
      baseloadMw,
      dailyAvgProductionMw,
      dailyErrorPct
    });
  }

  return samples;
}

export async function POST(request: Request) {
  try {
    const hereDir = path.dirname(fileURLToPath(import.meta.url)); // next-view/app/api/optimization
    const repoRoot = path.resolve(hereDir, "../../../../"); // repo root

    const outPath = path.join(repoRoot, "Overall_with_baseload.csv");
    const text = await fs.readFile(outPath, "utf8");
    const { bestS, bestW, bestB, series } = parseOverallWithBaseloadCsv(text);

    let gridSamples: GridSample[] = [];
    try {
      const logPath = path.join(repoRoot, "grid_search_log.csv");
      const logText = await fs.readFile(logPath, "utf8");
      gridSamples = parseGridSearchLogCsv(logText);
    } catch {
      gridSamples = [];
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

