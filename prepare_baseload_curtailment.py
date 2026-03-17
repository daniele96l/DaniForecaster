#!/usr/bin/env python
"""
Energy Optimization - Simple, Flat Version
No nested functions, straightforward logic.
"""

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
# MAIN OPTIMIZATION
# ============================================================================

def run_optimization():
    """Main optimization routine."""

    overall = pd.read_csv("Overall.csv")

    # Find column names (case-insensitive)
    cols = {c.lower(): c for c in overall.columns}
    date_col = cols.get("date", overall.columns[0])
    solar_col = cols.get("solar production, kwh", None)
    wind_col = cols.get("wind production, kwh (avg)", None)

    if solar_col is None or wind_col is None:
        print(f"ERROR: Cannot find solar and wind columns")
        print(f"Available columns: {list(overall.columns)}")
        return

    # Parse data
    if not pd.api.types.is_datetime64_any_dtype(overall[date_col]):
        overall[date_col] = pd.to_datetime(overall[date_col], errors="coerce")

    solar_raw = overall[solar_col].astype(float).to_numpy()
    wind_raw = overall[wind_col].astype(float).to_numpy()

    # Check for errors
    if np.isnan(solar_raw).any() or np.isnan(wind_raw).any():
        print("ERROR: Data contains NaN values")
        return

    if np.max(solar_raw) <= 0 or np.max(wind_raw) <= 0:
        print("ERROR: No positive values in solar or wind data")
        return

    # Grid search over capacities (simple 0..200 MW grid)
    S_values = np.linspace(0, 200, 41)
    W_values = np.linspace(0, 200, 41)

    best_B = -np.inf
    best_S = 0.0
    best_W = 0.0

    # Loop over all (S, W) pairs
    for i, S in enumerate(S_values):
        for j, W in enumerate(W_values):
            # Skip if no capacity
            if S == 0 and W == 0:
                continue

            # Compute production for this (S, W) using raw profiles
            P = S * solar_raw + W * wind_raw
            # Find baseload that gives ~10% curtailment
            B = find_baseload(P, target_curtailment=0.10)

            # Daily mean production constraint: daily_avg_production >= 0.7 * B
            daily_avg_production = np.mean(P)
            if B > best_B and daily_avg_production >= 0.7 * B:
                print(
                    "New best: B={:.2f} MW (S={:.1f} MW, W={:.1f} MW), "
                    "daily_avg_production={:.2f} MW".format(
                        B, S, W, daily_avg_production
                    )
                )
                best_B = B
                best_S = S
                best_W = W


    if best_B <= 0:
        print("ERROR: Could not find valid solution")
        return

    # Compute final production with best capacities on raw profiles
    P_optimal = best_S * solar_raw + best_W * wind_raw

    # Per-hour curtailment relative to baseload
    curtailment = np.maximum(P_optimal - best_B, 0.0)
    curtailment_ratio = np.zeros_like(P_optimal, dtype=float)
    mask = P_optimal > 0
    curtailment_ratio[mask] = curtailment[mask] / P_optimal[mask]

    # Add to dataframe (rounded) with short, readable names
    overall["SolarCap_MW"] = np.round(best_S, 2)
    overall["WindCap_MW"] = np.round(best_W, 2)
    overall["Baseload_MW"] = np.round(best_B, 2)
    overall["SolarScaled"] = np.round(best_S * solar_raw, 2)
    overall["WindScaled"] = np.round(best_W * wind_raw, 2)
    overall["ProdCombined"] = np.round(P_optimal, 2)

    # Instantaneous error vs baseload (fraction of baseload)
    # > 0 means under-producing vs baseload, < 0 means over-producing
    prod_error = (best_B - P_optimal) / best_B
    overall["HourlyShortfall"] = np.round(prod_error, 4)

    # Daily-average production and 70% baseload metric per row
    day_index = overall[date_col].dt.floor("D")
    overall["DailyAvgProd"] = (
        overall.groupby(day_index)["ProdCombined"].transform("mean")
    ).round(2)

    # Ensure original averaged wind column has at most 2 decimals
    overall[wind_col] = np.round(overall[wind_col].astype(float), 2)

    # Order columns for output
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
    ]
    ordered_cols = [
        c for c in preferred_cols if c in overall.columns
    ] + [
        c for c in overall.columns if c not in preferred_cols
    ]

    # Save formatted dataset
    overall.to_csv("Overall_with_baseload.csv", index=False, columns=ordered_cols)


# ============================================================================
# RUN
# ============================================================================

if __name__ == "__main__":
    run_optimization()