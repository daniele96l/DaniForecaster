from __future__ import annotations

from pathlib import Path
from typing import Dict, Tuple

import optuna
import pandas as pd
from pandas.tseries.offsets import MonthEnd
from sklearn.ensemble import RandomForestClassifier
from sklearn.metrics import accuracy_score, classification_report, confusion_matrix, f1_score


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


def get_class_weight(train_df: pd.DataFrame) -> str | None:
    class_counts = train_df["next_month_up"].value_counts(normalize=True)
    return "balanced" if class_counts.min() < 0.4 else None


def print_class_balance(train_df: pd.DataFrame) -> None:
    class_counts = train_df["next_month_up"].value_counts().sort_index()
    class_ratios = train_df["next_month_up"].value_counts(normalize=True).sort_index()
    class_weight = get_class_weight(train_df)

    print("Class distribution (train):")
    for cls in class_counts.index:
        print(f"  class {cls}: {class_counts[cls]} ({class_ratios[cls]:.2%})")
    print("Class balancing mode:", class_weight if class_weight is not None else "none")


def get_time_cv_splits(train_df: pd.DataFrame, n_splits: int = 5) -> list[Tuple[pd.DataFrame, pd.DataFrame]]:
    months = sorted(train_df["MonthEnd"].unique())
    total_months = len(months)
    step = max(1, total_months // (n_splits + 1))
    splits: list[Tuple[pd.DataFrame, pd.DataFrame]] = []

    for split_num in range(1, n_splits + 1):
        valid_start_idx = split_num * step
        valid_end_idx = min(valid_start_idx + step, total_months)
        if valid_start_idx >= total_months:
            break

        valid_months = months[valid_start_idx:valid_end_idx]
        if not valid_months:
            continue

        train_fold = train_df[train_df["MonthEnd"] < valid_months[0]].copy()
        valid_fold = train_df[train_df["MonthEnd"].isin(valid_months)].copy()
        if train_fold.empty or valid_fold.empty:
            continue

        splits.append((train_fold, valid_fold))

    if not splits:
        raise ValueError("Unable to build time-based CV splits. Check train data size.")
    return splits


def cross_validate_params(
    train_df: pd.DataFrame,
    params: Dict[str, int | float | str | None],
    trial: optuna.trial.Trial | None = None,
) -> float:
    cv_splits = get_time_cv_splits(train_df, n_splits=5)
    fold_scores = []
    for fold_idx, (train_fold, valid_fold) in enumerate(cv_splits):
        model = RandomForestClassifier(**params)
        model.fit(train_fold[FEATURE_COLS], train_fold["next_month_up"])
        pred = model.predict(valid_fold[FEATURE_COLS])
        fold_scores.append(f1_score(valid_fold["next_month_up"], pred))
        if trial is not None:
            intermediate_score = float(sum(fold_scores) / len(fold_scores))
            trial.report(intermediate_score, step=fold_idx)
            if trial.should_prune():
                raise optuna.exceptions.TrialPruned()
    return float(sum(fold_scores) / len(fold_scores))


def tune_hyperparameters(
    train_df: pd.DataFrame, n_trials: int = 30, early_stopping_patience: int = 8
) -> Dict[str, int | float | str | None]:
    class_weight = get_class_weight(train_df)
    tracker = {"best_score": float("-inf"), "no_improve_count": 0}

    def objective(trial: optuna.trial.Trial) -> float:
        params: Dict[str, int | float | str | None] = {
            "n_estimators": trial.suggest_int("n_estimators", 100, 700),
            "max_depth": trial.suggest_int("max_depth", 3, 16),
            "min_samples_split": trial.suggest_int("min_samples_split", 2, 30),
            "min_samples_leaf": trial.suggest_int("min_samples_leaf", 1, 20),
            "max_features": trial.suggest_categorical("max_features", ["sqrt", "log2", None]),
            "bootstrap": trial.suggest_categorical("bootstrap", [True, False]),
            "random_state": 42,
            "class_weight": class_weight,
            "n_jobs": -1,
        }
        return cross_validate_params(train_df, params, trial=trial)

    def early_stop_callback(study: optuna.study.Study, current_trial: optuna.trial.FrozenTrial) -> None:
        if current_trial.state != optuna.trial.TrialState.COMPLETE:
            return
        current_best = study.best_value
        if current_best > tracker["best_score"] + 1e-4:
            tracker["best_score"] = current_best
            tracker["no_improve_count"] = 0
        else:
            tracker["no_improve_count"] += 1
        if tracker["no_improve_count"] >= early_stopping_patience:
            study.stop()

    study = optuna.create_study(
        direction="maximize",
        pruner=optuna.pruners.MedianPruner(n_startup_trials=5, n_warmup_steps=2),
    )
    study.optimize(objective, n_trials=n_trials, callbacks=[early_stop_callback])

    best_params: Dict[str, int | float | str | None] = dict(study.best_params)
    best_params["random_state"] = 42
    best_params["class_weight"] = class_weight
    best_params["n_jobs"] = -1

    print("Best CV F1:", round(study.best_value, 4))
    print("Completed Optuna trials:", len(study.trials))
    print("Best Optuna params:", best_params)
    return best_params


def train_classifier(train_df: pd.DataFrame, params: Dict[str, int | float | str | None]) -> RandomForestClassifier:
    model = RandomForestClassifier(**params)
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
    print_class_balance(train_df)

    best_params = tune_hyperparameters(train_df, n_trials=3)
    model = train_classifier(train_df, best_params)
    y_pred, _ = evaluate_classifier(model, test_df)

    predictions_df = test_df[["Ticker", "MonthEnd", "next_month_up"]].copy()
    predictions_df["pred_next_month_up"] = y_pred.values
    predictions_df.to_csv(base_dir / "next_month_up_predictions.csv", index=False)

    featured_df = add_open_price_features(df_monthly)
    featured_df.to_csv(base_dir / "df_nasdaq_monthly_features.csv", index=False)


if __name__ == "__main__":
    run_pipeline(Path("."))
