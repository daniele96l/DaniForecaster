#!/usr/bin/env python
"""
Energy Optimization - Simple, Flat Version
No nested functions, straightforward logic.
"""

from typing import Tuple, List, Dict

import numpy as np
import pandas as pd


# ============================================================================
# HELPER FUNCTIONS (Top-level, not nested)
# ============================================================================

def compute_curtailment_ratio(production, baseload):
    """
    Compute curtailment ratio: how much energy exceeds the baseload.

    Args:
        production: array of hourly production values
        baseload: constant baseload level

    Returns:
        curtailment ratio (0.0 to 1.0)
    """
    excess = np.maximum(production - baseload, 0)
    curtailed_energy = np.sum(excess)
    total_energy = np.sum(production)

    if total_energy <= 0:
        return 0.0

    return curtailed_energy / total_energy


def find_baseload(production, target_curtailment=0.10):
    """
    Binary search to find baseload that hits target curtailment.

    Args:
        production: array of hourly production values
        target_curtailment: target curtailment ratio (default 0.10 = 10%)

    Returns:
        baseload value where curtailment ≈ target
    """
    if len(production) == 0 or np.sum(production) <= 0:
        return 0.0

    lo = 0.0
    hi = float(np.max(production))

    # Binary search for B where curtailment ≈ target
    for _ in range(100):
        mid = 0.5 * (lo + hi)
        ratio = compute_curtailment_ratio(production, mid)

        if ratio > target_curtailment:
            lo = mid  # curtailment too high, raise B
        else:
            hi = mid  # curtailment acceptable, lower B

        if hi - lo < 1e-8:
            break

    return 0.5 * (lo + hi)


# ============================================================================
# MAIN OPTIMIZATION HELPERS
# ============================================================================

def load_and_prepare_overall(path: str = "Overall.csv"):
    """Load Overall.csv, infer key columns, and return raw arrays + metadata."""
    print(f"Loading input data from {path} ...")
    overall = pd.read_csv(path)
    print(f"Loaded {len(overall)} rows.")

    cols = {c.lower(): c for c in overall.columns}
    date_col = cols.get("date", overall.columns[0])
    solar_col = cols.get("solar production, kwh", None)
    wind_col = cols.get("wind production, kwh (avg)", None)

    if solar_col is None or wind_col is None:
        print("ERROR: Cannot find solar and wind columns")
        print(f"Available columns: {list(overall.columns)}")
        return None, None, None, None, None, None

    if not pd.api.types.is_datetime64_any_dtype(overall[date_col]):
        overall[date_col] = pd.to_datetime(overall[date_col], errors="coerce")

    solar_raw = overall[solar_col].astype(float).to_numpy()
    wind_raw = overall[wind_col].astype(float).to_numpy()

    if np.isnan(solar_raw).any() or np.isnan(wind_raw).any():
        print("ERROR: Data contains NaN values")
        return None, None, None, None, None, None

    if np.max(solar_raw) <= 0 or np.max(wind_raw) <= 0:
        print("ERROR: No positive values in solar or wind data")
        return None, None, None, None, None, None

    return overall, date_col, solar_col, wind_col, solar_raw, wind_raw


def search_best_capacities(
    solar_raw: np.ndarray,
    wind_raw: np.ndarray,
) -> Tuple[float, float, float]:
    """
    Grid-search (S, W) in [0, 200] MW to find the best baseload B,
    enforcing the daily-average >= 0.7 * B constraint.
    """
    print("Starting capacity grid search over S,W in [0,200] MW (step 5 MW) ...")

    S_values = np.linspace(0, 200, 41)
    W_values = np.linspace(0, 200, 41)

    best_B = -np.inf
    best_S = 0.0
    best_W = 0.0

    grid_log: List[Dict[str, float]] = []

    for S in S_values:
        for W in W_values:
            if S == 0 and W == 0:
                continue

            P = S * solar_raw + W * wind_raw
            B = find_baseload(P, target_curtailment=0.10)

            daily_avg_production = float(np.mean(P))
            daily_error_pct = (
                (daily_avg_production - B) / B if B > 0 else 0.0
            )

            grid_log.append(
                {
                    "S_MW": float(S),
                    "W_MW": float(W),
                    "Baseload_MW": float(B),
                    "DailyAvgProd_MW": daily_avg_production,
                    "DailyErrorPct": daily_error_pct,
                }
            )

            if B > best_B and daily_avg_production >= 0.7 * B:
                print(
                    "New best candidate -> "
                    "B={:.2f} MW, S={:.1f} MW, W={:.1f} MW, "
                    "avg_prod={:.2f} MW".format(
                        B, S, W, daily_avg_production
                    )
                )
                best_B = B
                best_S = S
                best_W = W

    if grid_log:
        print("Writing grid search log to grid_search_log.csv ...")
        df_log = pd.DataFrame(grid_log)
        df_log.to_csv("grid_search_log.csv", index=False)

    if best_B <= 0:
        print("ERROR: Could not find valid solution")
        return 0.0, 0.0, 0.0

    print(
        "Final choice -> "
        "B={:.2f} MW, S={:.1f} MW, W={:.1f} MW".format(best_B, best_S, best_W)
    )
    return best_B, best_S, best_W


def build_output_dataframe(
    overall: pd.DataFrame,
    date_col: str,
    solar_col: str,
    wind_col: str,
    solar_raw: np.ndarray,
    wind_raw: np.ndarray,
    best_B: float,
    best_S: float,
    best_W: float,
) -> pd.DataFrame:
    """Attach all derived metrics/columns and write CSV."""
    P_optimal = best_S * solar_raw + best_W * wind_raw

    curtailment = np.maximum(P_optimal - best_B, 0.0)
    curtailment_ratio = np.zeros_like(P_optimal, dtype=float)
    mask = P_optimal > 0
    curtailment_ratio[mask] = curtailment[mask] / P_optimal[mask]

    overall["SolarCap_MW"] = np.round(best_S, 2)
    overall["WindCap_MW"] = np.round(best_W, 2)
    overall["Baseload_MW"] = np.round(best_B, 2)
    overall["SolarScaled"] = np.round(best_S * solar_raw, 2)
    overall["WindScaled"] = np.round(best_W * wind_raw, 2)
    overall["ProdCombined"] = np.round(P_optimal, 2)

    # HourlyShortfall = (B - production) / B:
    #   0.10 -> 10% below baseload
    #  -0.05 -> 5% above baseload (negative shortfall = excess)
    prod_error = (best_B - P_optimal) / best_B
    overall["HourlyShortfall"] = np.round(prod_error, 4)

    day_index = overall[date_col].dt.floor("D")
    overall["DailyAvgProd"] = (
        overall.groupby(day_index)["ProdCombined"].transform("mean")
    ).round(2)
    overall["DailyErrorPct"] = np.round(
        (overall["DailyAvgProd"] - overall["Baseload_MW"]) / overall["Baseload_MW"],
        4,
    )

    overall[wind_col] = np.round(overall[wind_col].astype(float), 2)

    preferred_cols = [
        date_col,
        solar_col,
        wind_col,
        "SolarCap_MW",
        "WindCap_MW",
        "Baseload_MW",
        "SolarScaled",
        "WindScaled",
        "ProdCombined",
        "HourlyShortfall",
        "DailyAvgProd",
        "DailyErrorPct",
    ]
    ordered_cols = [
        c for c in preferred_cols if c in overall.columns
    ] + [
        c for c in overall.columns if c not in preferred_cols
    ]

    print("Writing results to Overall_with_baseload.csv ...")
    overall.to_csv("Overall_with_baseload.csv", index=False, columns=ordered_cols)
    print("Done.")

    return overall


def run_optimization():
    """High-level orchestration for the baseload optimization."""
    (
        overall,
        date_col,
        solar_col,
        wind_col,
        solar_raw,
        wind_raw,
    ) = load_and_prepare_overall("Overall.csv")

    if overall is None:
        return

    best_B, best_S, best_W = search_best_capacities(
        solar_raw=solar_raw,
        wind_raw=wind_raw,
    )

    if best_B <= 0:
        return

    build_output_dataframe(
        overall=overall,
        date_col=date_col,
        solar_col=solar_col,
        wind_col=wind_col,
        solar_raw=solar_raw,
        wind_raw=wind_raw,
        best_B=best_B,
        best_S=best_S,
        best_W=best_W,
    )


# ============================================================================
# RUN
# ============================================================================

if __name__ == "__main__":
    run_optimization()