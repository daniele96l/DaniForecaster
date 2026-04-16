from __future__ import annotations

import json
import random
import time
from pathlib import Path
from typing import Any, Dict, Tuple

import numpy as np
import optuna
import pandas as pd
from pandas.tseries.offsets import MonthEnd
from sklearn.ensemble import ExtraTreesClassifier, RandomForestClassifier
from sklearn.metrics import (
    accuracy_score,
    balanced_accuracy_score,
    classification_report,
    confusion_matrix,
    f1_score,
    recall_score,
)


GLOBAL_SEED = 42
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
    "open_ret_sign_sum_3",
    "open_ret_abs_mean_3",
    "open_ret_roll_z_6",
    "open_vs_roll6",
    "open_vs_roll9",
    "open_vs_roll3",
]


def set_global_seed(seed: int = GLOBAL_SEED) -> None:
    random.seed(seed)
    np.random.seed(seed)


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

    out["open_pct_change_1m"] = grouped_open.pct_change(1).clip(-0.35, 0.35)
    out["open_pct_change_3m"] = grouped_open.pct_change(3).clip(-0.7, 0.7)

    grouped_ret = out.groupby("Ticker")["open_pct_change_1m"]
    out["open_pct_change_1m_lag1"] = grouped_ret.shift(1)
    out["open_pct_change_1m_lag2"] = grouped_ret.shift(2)
    out["open_pct_change_1m_lag3"] = grouped_ret.shift(3)

    out["open_ret_roll_mean_3"] = grouped_ret.transform(lambda s: s.rolling(window=3).mean())
    out["open_ret_roll_std_3"] = grouped_ret.transform(lambda s: s.rolling(window=3).std())
    out["open_ret_roll_mean_6"] = grouped_ret.transform(lambda s: s.rolling(window=6).mean())
    out["open_ret_roll_std_6"] = grouped_ret.transform(lambda s: s.rolling(window=6).std())
    out["open_ret_sign_sum_3"] = grouped_ret.transform(
        lambda s: np.sign(s).rolling(window=3).sum()
    )
    out["open_ret_abs_mean_3"] = grouped_ret.transform(lambda s: s.abs().rolling(window=3).mean())
    out["open_ret_roll_z_6"] = (
        out["open_pct_change_1m"] - out["open_ret_roll_mean_6"]
    ) / (out["open_ret_roll_std_6"] + 1e-6)

    out["open_vs_roll3"] = (out["Open"] / grouped_open.transform(lambda s: s.rolling(window=3).mean())) - 1
    out["open_vs_roll6"] = (out["Open"] / grouped_open.transform(lambda s: s.rolling(window=6).mean())) - 1
    out["open_vs_roll9"] = (out["Open"] / grouped_open.transform(lambda s: s.rolling(window=9).mean())) - 1
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


def time_split(
    model_df: pd.DataFrame, split_ratio: float = 0.8, min_test_months: int = 12
) -> Tuple[pd.DataFrame, pd.DataFrame]:
    unique_months = sorted(model_df["MonthEnd"].unique())
    if len(unique_months) < 3:
        raise ValueError("Not enough monthly data for train/test split.")

    test_months = max(min_test_months, int(round(len(unique_months) * (1 - split_ratio))))
    test_months = min(max(1, test_months), len(unique_months) - 1)
    split_month = unique_months[-test_months]
    train_df = model_df[model_df["MonthEnd"] < split_month].copy()
    test_df = model_df[model_df["MonthEnd"] >= split_month].copy()
    if train_df.empty or test_df.empty:
        raise ValueError("Time split produced empty train or test set.")
    return train_df, test_df


def get_class_weight(train_df: pd.DataFrame) -> str | None:
    class_counts = train_df["next_month_up"].value_counts(normalize=True)
    return "balanced" if class_counts.min() < 0.4 else None


def class_weight_from_mode(train_df: pd.DataFrame, mode: str) -> str | Dict[int, float] | None:
    if mode in {"none", "balanced", "balanced_subsample"}:
        return None if mode == "none" else mode

    counts = train_df["next_month_up"].value_counts()
    minority_class = int(counts.idxmin())
    weight_scale = {
        "minority_x1.25": 1.25,
        "minority_x1.5": 1.5,
        "minority_x2.0": 2.0,
    }[mode]
    weights: Dict[int, float] = {0: 1.0, 1: 1.0}
    weights[minority_class] = weight_scale
    return weights


def print_class_balance(train_df: pd.DataFrame) -> None:
    class_counts = train_df["next_month_up"].value_counts().sort_index()
    class_ratios = train_df["next_month_up"].value_counts(normalize=True).sort_index()
    class_weight = get_class_weight(train_df)

    print("Class distribution (train):")
    for cls in class_counts.index:
        print(f"  class {cls}: {class_counts[cls]} ({class_ratios[cls]:.2%})")
    print("Class balancing mode:", class_weight if class_weight is not None else "none")


def get_time_cv_splits(
    train_df: pd.DataFrame,
    valid_window_months: int = 3,
    gap_months: int = 1,
    min_train_months: int = 18,
    max_splits: int = 6,
) -> list[Tuple[pd.DataFrame, pd.DataFrame]]:
    months = sorted(train_df["MonthEnd"].unique())
    total_months = len(months)
    splits: list[Tuple[pd.DataFrame, pd.DataFrame]] = []

    start_idx = min_train_months + gap_months
    while start_idx + valid_window_months <= total_months:
        train_end_idx = start_idx - gap_months
        valid_months = months[start_idx : start_idx + valid_window_months]
        train_months = months[:train_end_idx]

        if not valid_months or not train_months:
            start_idx += valid_window_months
            continue

        train_fold = train_df[train_df["MonthEnd"].isin(train_months)].copy()
        valid_fold = train_df[train_df["MonthEnd"].isin(valid_months)].copy()
        if train_fold.empty or valid_fold.empty:
            start_idx += valid_window_months
            continue

        splits.append((train_fold, valid_fold))
        start_idx += valid_window_months

    if len(splits) > max_splits:
        splits = splits[-max_splits:]

    if not splits:
        fallback_min_train = max(6, min_train_months // 2)
        start_idx = fallback_min_train
        while start_idx + 1 <= total_months:
            valid_months = months[start_idx : start_idx + 1]
            train_months = months[:start_idx]
            if not valid_months or not train_months:
                start_idx += 1
                continue
            train_fold = train_df[train_df["MonthEnd"].isin(train_months)].copy()
            valid_fold = train_df[train_df["MonthEnd"].isin(valid_months)].copy()
            if not train_fold.empty and not valid_fold.empty:
                splits.append((train_fold, valid_fold))
            start_idx += 1

    if not splits:
        raise ValueError("Unable to build time-based CV splits. Increase available history.")
    return splits


def get_adaptive_n_trials(train_df: pd.DataFrame, min_trials: int = 18, max_trials: int = 50) -> int:
    n_rows = len(train_df)
    if n_rows < 1200:
        return min_trials
    if n_rows < 3000:
        return min(min_trials + 8, max_trials)
    return max_trials


def train_model(train_fold: pd.DataFrame, params: Dict[str, Any]) -> RandomForestClassifier | ExtraTreesClassifier:
    model_type = params["model_type"]
    model_params = {k: v for k, v in params.items() if k != "model_type"}
    if model_type == "rf":
        model: RandomForestClassifier | ExtraTreesClassifier = RandomForestClassifier(**model_params)
    else:
        model = ExtraTreesClassifier(**model_params)
    model.fit(train_fold[FEATURE_COLS], train_fold["next_month_up"])
    return model


def tune_threshold(y_true: pd.Series, y_prob: np.ndarray) -> Tuple[float, float]:
    best_threshold = 0.5
    best_score = -1.0
    for threshold in np.linspace(0.3, 0.7, 9):
        y_pred = (y_prob >= threshold).astype(int)
        score = balanced_accuracy_score(y_true, y_pred)
        if score > best_score:
            best_score = score
            best_threshold = float(threshold)
    return best_threshold, float(best_score)


def cross_validate_params(
    train_df: pd.DataFrame,
    params: Dict[str, Any],
    trial: optuna.trial.Trial | None = None,
) -> Tuple[float, float]:
    cv_splits = get_time_cv_splits(train_df)
    fold_scores = []
    fold_thresholds = []
    for fold_idx, (train_fold, valid_fold) in enumerate(cv_splits):
        model = train_model(train_fold, params)
        valid_prob = model.predict_proba(valid_fold[FEATURE_COLS])[:, 1]
        threshold, fold_score = tune_threshold(valid_fold["next_month_up"], valid_prob)
        fold_scores.append(fold_score)
        fold_thresholds.append(threshold)
        if trial is not None:
            intermediate_score = float(sum(fold_scores) / len(fold_scores))
            trial.report(intermediate_score, step=fold_idx)
            if trial.should_prune():
                raise optuna.exceptions.TrialPruned()
    return float(sum(fold_scores) / len(fold_scores)), float(np.median(fold_thresholds))


def tune_hyperparameters(
    train_df: pd.DataFrame, n_trials: int | None = None, early_stopping_patience: int = 10
) -> Tuple[Dict[str, Any], float]:
    n_trials = n_trials or get_adaptive_n_trials(train_df)
    tracker = {"best_score": float("-inf"), "no_improve_count": 0}
    class_weight_modes = ["none", "balanced", "balanced_subsample", "minority_x1.25", "minority_x1.5"]

    def objective(trial: optuna.trial.Trial) -> float:
        class_weight_mode = trial.suggest_categorical("class_weight_mode", class_weight_modes)
        class_weight = class_weight_from_mode(train_df, class_weight_mode)
        params: Dict[str, Any] = {
            "model_type": trial.suggest_categorical("model_type", ["rf", "et"]),
            "n_estimators": trial.suggest_int("n_estimators", 120, 450),
            "max_depth": trial.suggest_int("max_depth", 3, 12),
            "min_samples_split": trial.suggest_int("min_samples_split", 8, 36),
            "min_samples_leaf": trial.suggest_int("min_samples_leaf", 3, 18),
            "max_features": trial.suggest_categorical("max_features", ["sqrt", "log2", 0.5, 0.8]),
            "bootstrap": trial.suggest_categorical("bootstrap", [True, False]),
            "random_state": GLOBAL_SEED,
            "class_weight": class_weight,
            "n_jobs": -1,
        }
        cv_score, cv_threshold = cross_validate_params(train_df, params, trial=trial)
        trial.set_user_attr("cv_threshold", cv_threshold)
        return cv_score

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
        sampler=optuna.samplers.TPESampler(seed=GLOBAL_SEED),
        pruner=optuna.pruners.MedianPruner(n_startup_trials=5, n_warmup_steps=2),
    )
    study.optimize(objective, n_trials=n_trials, callbacks=[early_stop_callback])

    best_trial = study.best_trial
    best_params: Dict[str, Any] = dict(best_trial.params)
    class_weight_mode = str(best_params.pop("class_weight_mode"))
    best_params["class_weight"] = class_weight_from_mode(train_df, class_weight_mode)
    best_params["random_state"] = GLOBAL_SEED
    best_params["n_jobs"] = -1
    best_threshold = float(best_trial.user_attrs.get("cv_threshold", 0.5))

    print("Best CV balanced accuracy:", round(study.best_value, 4))
    print("Completed Optuna trials:", len(study.trials))
    print("Best Optuna params:", best_params)
    print("Best CV threshold:", round(best_threshold, 4))
    return best_params, best_threshold


def train_classifier(
    train_df: pd.DataFrame, params: Dict[str, Any]
) -> RandomForestClassifier | ExtraTreesClassifier:
    return train_model(train_df, params)


def evaluate_classifier(
    model: RandomForestClassifier | ExtraTreesClassifier, test_df: pd.DataFrame, threshold: float
) -> Tuple[pd.Series, pd.DataFrame, Dict[str, float]]:
    y_true = test_df["next_month_up"]
    y_prob = model.predict_proba(test_df[FEATURE_COLS])[:, 1]
    y_pred = pd.Series((y_prob >= threshold).astype(int), index=test_df.index)

    accuracy = float(accuracy_score(y_true, y_pred))
    balanced_acc = float(balanced_accuracy_score(y_true, y_pred))
    macro_f1 = float(f1_score(y_true, y_pred, average="macro"))
    recall_down = float(recall_score(y_true, y_pred, pos_label=0))
    recall_up = float(recall_score(y_true, y_pred, pos_label=1))

    print("Threshold:", round(threshold, 4))
    print("Accuracy:", round(accuracy, 4))
    print("Balanced accuracy:", round(balanced_acc, 4))
    print("Macro F1:", round(macro_f1, 4))
    print("Recall class 0 (down):", round(recall_down, 4))
    print("Recall class 1 (up):", round(recall_up, 4))
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
    metrics = {
        "accuracy": accuracy,
        "balanced_accuracy": balanced_acc,
        "macro_f1": macro_f1,
        "recall_class_0": recall_down,
        "recall_class_1": recall_up,
        "threshold": float(threshold),
    }
    return y_pred, importance, metrics


def run_pipeline(base_dir: Path) -> None:
    set_global_seed(GLOBAL_SEED)
    started_at = time.time()

    df_monthly = load_monthly_dataset(base_dir)
    model_df = build_model_dataset(df_monthly)
    train_df, test_df = time_split(model_df, split_ratio=0.8, min_test_months=12)

    print("Train rows:", len(train_df), "Test rows:", len(test_df))
    print("Train month range:", train_df["MonthEnd"].min(), "to", train_df["MonthEnd"].max())
    print("Test month range:", test_df["MonthEnd"].min(), "to", test_df["MonthEnd"].max())
    print_class_balance(train_df)

    best_params, best_threshold = tune_hyperparameters(train_df, n_trials=None)
    model = train_classifier(train_df, best_params)
    y_pred, importance, metrics = evaluate_classifier(model, test_df, threshold=best_threshold)

    predictions_df = test_df[["Ticker", "MonthEnd", "next_month_up"]].copy()
    predictions_df["pred_next_month_up"] = y_pred.values
    predictions_df["pred_prob_up"] = model.predict_proba(test_df[FEATURE_COLS])[:, 1]
    predictions_df.to_csv(base_dir / "next_month_up_predictions.csv", index=False)

    featured_df = add_open_price_features(df_monthly)
    featured_df.to_csv(base_dir / "df_nasdaq_monthly_features.csv", index=False)

    elapsed_seconds = round(time.time() - started_at, 2)
    metrics["runtime_seconds"] = elapsed_seconds
    print("Runtime seconds:", elapsed_seconds)

    artifacts = {
        "seed": GLOBAL_SEED,
        "best_params": best_params,
        "metrics": metrics,
        "feature_cols": FEATURE_COLS,
        "feature_importance": importance.to_dict(orient="records"),
    }
    with open(base_dir / "next_month_up_training_artifacts.json", "w", encoding="utf-8") as f:
        json.dump(artifacts, f, indent=2, default=str)


if __name__ == "__main__":
    run_pipeline(Path("."))
