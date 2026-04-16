from __future__ import annotations

from pathlib import Path
from typing import Tuple

import pandas as pd
from pandas.tseries.offsets import MonthEnd
from sklearn.ensemble import RandomForestClassifier
from sklearn.metrics import accuracy_score, classification_report, confusion_matrix


FEATURE_COLS = [
    "open_pct_change_1m",
    "open_pct_change_3m",
    "open_pct_change_1m_lag1",
    "open_pct_change_1m_lag2",
    "open_pct_change_1m_lag3",
    "open_ret_roll_mean_3",
    "open_ret_roll_std_3",
    "open_ret_roll_mean_6",
    "open_ret_roll_std_6",
    "open_vs_roll3",
]


def daily_to_monthly(df: pd.DataFrame) -> pd.DataFrame:
    out = df.copy()
    out["Date"] = pd.to_datetime(out["Date"])
    out = out.sort_values(["Ticker", "Date"]).set_index("Date")
    monthly = (
        out.groupby(["Ticker", pd.Grouper(freq=MonthEnd())])
        .agg(Open=("Open", "first"))
        .reset_index()
    )
    return monthly.rename(columns={"Date": "MonthEnd"})


def add_next_month_direction(monthly: pd.DataFrame) -> pd.DataFrame:
    out = monthly.sort_values(["Ticker", "MonthEnd"]).copy()
    next_open = out.groupby("Ticker")["Open"].shift(-1)
    out["next_month_up"] = pd.Series(pd.NA, index=out.index, dtype="Int64")
    out.loc[next_open > out["Open"], "next_month_up"] = 1
    out.loc[next_open < out["Open"], "next_month_up"] = 0
    out.loc[next_open.isna(), "next_month_up"] = pd.NA
    return out


def add_open_price_features(monthly: pd.DataFrame) -> pd.DataFrame:
    out = monthly.sort_values(["Ticker", "MonthEnd"]).copy()
    grouped_open = out.groupby("Ticker")["Open"]

    out["open_pct_change_1m"] = grouped_open.pct_change(1)
    out["open_pct_change_3m"] = grouped_open.pct_change(3)

    grouped_ret = out.groupby("Ticker")["open_pct_change_1m"]
    out["open_pct_change_1m_lag1"] = grouped_ret.shift(1)
    out["open_pct_change_1m_lag2"] = grouped_ret.shift(2)
    out["open_pct_change_1m_lag3"] = grouped_ret.shift(3)

    out["open_ret_roll_mean_3"] = grouped_ret.transform(lambda s: s.rolling(window=3).mean())
    out["open_ret_roll_std_3"] = grouped_ret.transform(lambda s: s.rolling(window=3).std())
    out["open_ret_roll_mean_6"] = grouped_ret.transform(lambda s: s.rolling(window=6).mean())
    out["open_ret_roll_std_6"] = grouped_ret.transform(lambda s: s.rolling(window=6).std())

    out["open_vs_roll3"] = (out["Open"] / grouped_open.transform(lambda s: s.rolling(window=3).mean())) - 1
    return out


def load_monthly_dataset(base_dir: Path) -> pd.DataFrame:
    monthly_path = base_dir / "df_nasdaq_monthly.csv"
    eod_path = base_dir / "df_nasdaq_eod.csv"

    if monthly_path.exists():
        df_monthly = pd.read_csv(monthly_path)
    elif eod_path.exists():
        df_eod = pd.read_csv(eod_path)
        df_monthly = add_next_month_direction(daily_to_monthly(df_eod))
    else:
        raise FileNotFoundError("Missing df_nasdaq_monthly.csv (or df_nasdaq_eod.csv fallback).")

    df_monthly["MonthEnd"] = pd.to_datetime(df_monthly["MonthEnd"])
    return df_monthly


def build_model_dataset(df_monthly: pd.DataFrame) -> pd.DataFrame:
    featured = add_open_price_features(df_monthly)
    model_df = featured.dropna(subset=["next_month_up", *FEATURE_COLS]).copy()
    model_df["next_month_up"] = model_df["next_month_up"].astype(int)
    return model_df


def time_split(model_df: pd.DataFrame, split_ratio: float = 0.8) -> Tuple[pd.DataFrame, pd.DataFrame]:
    unique_months = sorted(model_df["MonthEnd"].unique())
    split_idx = int(len(unique_months) * split_ratio)
    split_month = unique_months[split_idx]
    train_df = model_df[model_df["MonthEnd"] < split_month].copy()
    test_df = model_df[model_df["MonthEnd"] >= split_month].copy()
    return train_df, test_df


def train_classifier(train_df: pd.DataFrame) -> RandomForestClassifier:
    class_counts = train_df["next_month_up"].value_counts(normalize=True)
    class_weight = "balanced" if class_counts.min() < 0.4 else None

    model = RandomForestClassifier(
        n_estimators=300,
        max_depth=8,
        random_state=42,
        class_weight=class_weight,
    )
    model.fit(train_df[FEATURE_COLS], train_df["next_month_up"])
    return model


def evaluate_classifier(
    model: RandomForestClassifier, test_df: pd.DataFrame
) -> Tuple[pd.Series, pd.DataFrame]:
    y_true = test_df["next_month_up"]
    y_pred = pd.Series(model.predict(test_df[FEATURE_COLS]), index=test_df.index)

    print("Accuracy:", round(accuracy_score(y_true, y_pred), 4))
    print("Confusion matrix:")
    print(confusion_matrix(y_true, y_pred))
    print("Classification report:")
    print(classification_report(y_true, y_pred, digits=4))

    importance = (
        pd.DataFrame({"feature": FEATURE_COLS, "importance": model.feature_importances_})
        .sort_values("importance", ascending=False)
        .reset_index(drop=True)
    )
    print("Feature importance:")
    print(importance)
    return y_pred, importance


def run_pipeline(base_dir: Path) -> None:
    df_monthly = load_monthly_dataset(base_dir)
    model_df = build_model_dataset(df_monthly)
    train_df, test_df = time_split(model_df, split_ratio=0.8)

    print("Train rows:", len(train_df), "Test rows:", len(test_df))
    print("Train month range:", train_df["MonthEnd"].min(), "to", train_df["MonthEnd"].max())
    print("Test month range:", test_df["MonthEnd"].min(), "to", test_df["MonthEnd"].max())

    model = train_classifier(train_df)
    y_pred, _ = evaluate_classifier(model, test_df)

    predictions_df = test_df[["Ticker", "MonthEnd", "next_month_up"]].copy()
    predictions_df["pred_next_month_up"] = y_pred.values
    predictions_df.to_csv(base_dir / "next_month_up_predictions.csv", index=False)

    featured_df = add_open_price_features(df_monthly)
    featured_df.to_csv(base_dir / "df_nasdaq_monthly_features.csv", index=False)


if __name__ == "__main__":
    run_pipeline(Path("."))
