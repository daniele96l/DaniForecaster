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

    # Drop NaNs and sort by datetime before formatting
    result = df_melted[["Date", "Production, KWh"]].dropna().sort_values("Date")

    # Format as DD/MM/YYYY HH:MM
    result["Date"] = result["Date"].dt.strftime("%d/%m/%Y %H:%M")
    result.to_csv("Wind.csv", index=False)


if __name__ == "__main__":
    main()
