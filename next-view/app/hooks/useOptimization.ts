import { useCallback, useState } from "react";

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

type Status = "idle" | "running" | "done" | "error";

export function useOptimization() {
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<OptimizationResult | null>(null);

  const runOptimization = useCallback(async (params?: OptimizationParams) => {
    try {
      setStatus("running");
      setError(null);
      setResult(null);
      const res = await fetch("/api/optimization", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(params ?? {})
      });
      const json = (await res.json()) as OptimizationResult & { error?: string };
      if (!res.ok || json.error) {
        throw new Error(json.error || `HTTP ${res.status}`);
      }
      setResult(json);
      setStatus("done");
    } catch (e) {
      setError(String(e));
      setStatus("error");
    }
  }, []);

  return { status, error, result, runOptimization };
}

