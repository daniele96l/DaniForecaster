#!/usr/bin/env python

import pandas as pd


def main() -> None:
    df = pd.read_excel("Wind.xlsx", header=2)
    df = df.drop(columns=["Unnamed: 25"], errors="ignore")

    # First column is the date
    df.rename(columns={df.columns[0]: "Date"}, inplace=True)
    df["Date"] = pd.to_datetime(df["Date"])

    # Wide (1..24 columns) -> long with one row per hour
    df_melted = df.melt(
        id_vars="Date", var_name="Hour", value_name="Production, KWh"
    )

    # Use actual hour value from the column (1..24 -> 0..23)
    df_melted["Hour"] = pd.to_numeric(df_melted["Hour"], errors="coerce")
    df_melted["Date"] = df_melted["Date"] + pd.to_timedelta(
        df_melted["Hour"] - 1, unit="h"
    )

    # Save original non-averaged time series (with year)
    df_raw = df_melted[["Date", "Production, KWh"]].dropna().sort_values("Date")
    df_raw["Date"] = df_raw["Date"].dt.strftime("%d/%m/%Y %H:%M")
    df_raw.to_csv("Wind_raw.csv", index=False)

    # Drop NaNs before aggregating
    df_melted = df_melted.dropna(subset=["Production, KWh"])

    # Group by month, day, and hour (year-agnostic) and average over years
    df_melted["Month"] = df_melted["Date"].dt.month
    df_melted["Day"] = df_melted["Date"].dt.day
    df_melted["HourOfDay"] = df_melted["Date"].dt.hour

    grouped = (
        df_melted.groupby(["Month", "Day", "HourOfDay"], as_index=False)[
            "Production, KWh"
        ].mean()
    )

    # Build a synthetic date to format as DD/MM HH:MM (no year)
    synthetic_dt = pd.to_datetime(
        dict(
            year=2000,
            month=grouped["Month"],
            day=grouped["Day"],
            hour=grouped["HourOfDay"],
        )
    )
    grouped["Date"] = synthetic_dt.dt.strftime("%d/%m %H:%M")

    result = grouped.sort_values(["Month", "Day", "HourOfDay"])[
        ["Date", "Production, KWh"]
    ]
    result.to_csv("Wind.csv", index=False)

    # Build overall CSV with solar production and average wind production
    solar = pd.read_csv("Solar.CSV")
    solar["Date"] = pd.to_datetime(solar["Date"], dayfirst=True)
    solar["Month"] = solar["Date"].dt.month
    solar["Day"] = solar["Date"].dt.day
    solar["HourOfDay"] = solar["Date"].dt.hour

    merged = solar.merge(
        grouped[["Month", "Day", "HourOfDay", "Production, KWh"]],
        on=["Month", "Day", "HourOfDay"],
        how="left",
        suffixes=("_solar", "_wind"),
    )

    overall = merged[
        ["Date", "Production, KWh_solar", "Production, KWh_wind"]
    ].rename(
        columns={
            "Production, KWh_solar": "Solar Production, KWh",
            "Production, KWh_wind": "Wind Production, KWh (avg)",
        }
    )
    overall.to_csv("Overall.csv", index=False)


if __name__ == "__main__":
    main()
