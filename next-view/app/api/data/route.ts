import { NextResponse } from "next/server";
import path from "path";
import { promises as fs } from "fs";

type Point = { date: string; value: number };

function parseDateTime(value: string): Date | null {
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
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day))
    return null;
  return new Date(year, month, day, hour, minute);
}

// Wind CSV is now "DD/MM HH:MM" without a year.
// Assume a synthetic constant year so we can still build Date objects.
function parseWindDateTime(value: string): Date | null {
  if (!value) return null;
  const [datePart, timePart] = value.split(" ");
  if (!datePart) return null;
  const [d, m] = datePart.split("/");
  const [hh = "00", mm = "00"] = (timePart || "00:00").split(":");
  const year = 2020;
  const day = Number(d);
  const month = Number(m) - 1;
  const hour = Number(hh);
  const minute = Number(mm);
  if (!Number.isFinite(day) || !Number.isFinite(month)) return null;
  return new Date(year, month, day, hour, minute);
}

function parseSolarCsv(text: string): Point[] {
  const lines = text.split(/\r?\n/);
  const dataLines = lines.slice(3);
  const out: Point[] = [];
  for (const raw of dataLines) {
    const line = raw.trim();
    if (!line) continue;
    const [dateStr, valueStr] = line.split(",");
    const date = parseDateTime(dateStr);
    const value = parseFloat(valueStr);
    if (!date || !Number.isFinite(value)) continue;
    out.push({ date: date.toISOString(), value });
  }
  return out;
}

function parseWindCsv(text: string): Point[] {
  const lines = text.split(/\r?\n/);
  const dataLines = lines.slice(1);
  const out: Point[] = [];
  for (const raw of dataLines) {
    const line = raw.trim();
    if (!line) continue;
    const [dateStrRaw, valueStr] = line.split(",");
    const dateStr = dateStrRaw?.replace(/"/g, "");
    const date = parseWindDateTime(dateStr);
    const value = parseFloat(valueStr);
    if (!date || !Number.isFinite(value)) continue;
    out.push({ date: date.toISOString(), value });
  }
  return out;
}

function parseWindRawCsv(text: string): Point[] {
  const lines = text.split(/\r?\n/);
  const dataLines = lines.slice(1);
  const out: Point[] = [];
  for (const raw of dataLines) {
    const line = raw.trim();
    if (!line) continue;
    const [dateStrRaw, valueStr] = line.split(",");
    const dateStr = dateStrRaw?.replace(/"/g, "");
    const date = parseDateTime(dateStr);
    const value = parseFloat(valueStr);
    if (!date || !Number.isFinite(value)) continue;
    out.push({ date: date.toISOString(), value });
  }
  return out;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const requested = searchParams.get("dataset");
  const dataset: "solar" | "wind" | "wind_raw" =
    requested === "wind" || requested === "wind_raw" ? requested : "solar";
  const yearParam = searchParams.get("year");
  const year = yearParam ? Number(yearParam) : undefined;

  try {
    const root = process.cwd();
    let csvPath: string;
    let allPoints: Point[];

    if (dataset === "solar") {
      csvPath = path.join(root, "..", "Solar.CSV");
      const text = await fs.readFile(csvPath, "utf8");
      allPoints = parseSolarCsv(text);
    } else if (dataset === "wind") {
      csvPath = path.join(root, "..", "Wind.csv");
      const text = await fs.readFile(csvPath, "utf8");
      allPoints = parseWindCsv(text);
    } else {
      csvPath = path.join(root, "..", "Wind_raw.csv");
      const text = await fs.readFile(csvPath, "utf8");
      allPoints = parseWindRawCsv(text);
    }

    const filtered =
      dataset === "wind_raw" && year != null && Number.isFinite(year)
        ? allPoints.filter(
            (p) => new Date(p.date).getFullYear() === Number(year)
          )
        : allPoints;

    const values = filtered.map((p) => p.value);
    const min = values.length ? Math.min(...values) : null;
    const max = values.length ? Math.max(...values) : null;
    const sum = values.reduce((a, b) => a + b, 0);
    const avg = values.length ? sum / values.length : null;

    const years =
      dataset === "wind_raw"
        ? Array.from(
            new Set(allPoints.map((p) => new Date(p.date).getFullYear()))
          ).sort((a, b) => a - b)
        : [];

    return NextResponse.json({
      dataset,
      year: year ?? null,
      years,
      points: filtered,
      stats: { min, max, avg, count: filtered.length }
    });
  } catch (e) {
    return NextResponse.json(
      { error: String(e), dataset, year: year ?? null },
      { status: 500 }
    );
  }
}

