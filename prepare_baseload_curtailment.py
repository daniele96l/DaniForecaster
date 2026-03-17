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
    for it in range(100):
        mid = 0.5 * (lo + hi)
        ratio = compute_curtailment_ratio(production, mid)

        # Minimal binary-search log for debugging
        print(
            f"[binsearch] iter={it:02d} lo={lo:.4f} hi={hi:.4f} "
            f"mid={mid:.4f} curt={ratio*100:.3f}%"
        )

        if ratio > target_curtailment:
            lo = mid  # curtailment too high, raise B
        else:
            hi = mid  # curtailment acceptable, lower B

        if hi - lo < 1e-8:
            break

    return 0.5 * (lo + hi)


def compute_production(solar, wind, solar_capacity, wind_capacity):
    """
    Compute combined production: P = S*solar + W*wind

    Args:
        solar: normalized solar profile (0-1)
        wind: normalized wind profile (0-1)
        solar_capacity: solar scaling factor
        wind_capacity: wind scaling factor

    Returns:
        production array
    """
    return solar_capacity * solar + wind_capacity * wind


def normalize_profile(profile):
    """
    Normalize a profile to [0, 1] range.

    Args:
        profile: numpy array

    Returns:
        normalized array
    """
    max_val = np.max(profile)
    if max_val <= 0:
        return profile
    return profile / max_val


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

    # Normalize
    solar_norm = normalize_profile(solar_raw)
    wind_norm = normalize_profile(wind_raw)

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

            # Compute production for this (S, W)
            P = compute_production(solar_norm, wind_norm, S, W)

            # Find baseload that gives ~10% curtailment
            B = find_baseload(P, target_curtailment=0.10)
            curtailment = compute_curtailment_ratio(P, B)

            # Keep track of best
            if B > best_B:
                best_B = B
                best_S = S
                best_W = W
                best_curtailment = curtailment

    if best_B <= 0:
        print("ERROR: Could not find valid solution")
        return

    # Compute final production
    P_optimal = compute_production(solar_norm, wind_norm, best_S, best_W)

    # Add to dataframe (rounded to 2 decimal places)
    overall["SolarScalingFactor"] = np.round(best_S, 2)
    overall["WindScalingFactor"] = np.round(best_W, 2)
    overall["SolarScaled"] = np.round(best_S * solar_norm, 2)
    overall["WindScaled"] = np.round(best_W * wind_norm, 2)
    overall["ProductionCombined"] = np.round(P_optimal, 2)
    overall["Baseload"] = np.round(best_B, 2)

    # Ensure original averaged wind column has at most 2 decimals
    overall[wind_col] = np.round(overall[wind_col].astype(float), 2)

    # Save without per-hour curtailment columns
    overall.to_csv(
        "Overall_with_baseload.csv",
        index=False,
        columns=[
            col
            for col in overall.columns
            if col not in ("Curtailment", "CurtailmentRatio")
        ],
    )


# ============================================================================
# RUN
# ============================================================================

if __name__ == "__main__":
    run_optimization()