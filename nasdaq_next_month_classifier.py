from __future__ import annotations

import json
import random
import time
import traceback
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, TextIO, Tuple

import numpy as np
import optuna
import pandas as pd
from pandas.tseries.offsets import MonthEnd
from sklearn.dummy import DummyClassifier
from sklearn.ensemble import ExtraTreesClassifier, RandomForestClassifier
from sklearn.metrics import (
    accuracy_score,
    balanced_accuracy_score,
    classification_report,
    confusion_matrix,
    cohen_kappa_score,
    f1_score,
    jaccard_score,
    log_loss,
    matthews_corrcoef,
    precision_score,
    recall_score,
    roc_auc_score,
)
from sklearn.preprocessing import label_binarize


GLOBAL_SEED = 42
NEUTRAL_RETURN_BAND = 0.02
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
    "hl_range_over_open",
    "close_over_open_ret",
    "close_pct_change_1m",
    "close_pct_change_3m",
    "close_vs_roll6",
    "volume_log1p",
    "volume_pct_change_1m",
    "volume_roll_z_6",
]

FEATURE_ENGINEERING_SPEC: Dict[str, Any] = {
    "time_axis": "MonthEnd (pandas MonthEnd frequency), one row per (Ticker, month)",
    "input_price": "Open required; High/Low/Close/Volume optional on monthly CSV. EOD: Open=first, High=max, Low=min, Close=last, Volume=sum per month per ticker",
    "eod_to_monthly": {
        "input_requires": ["Ticker", "Date", "Open"],
        "optional_columns": ["High", "Low", "Close", "Volume"],
        "logic": "Sort by Ticker,Date; groupby (Ticker, Grouper(Date, freq=MonthEnd)); agg Open first, High max, Low min, Close last, Volume sum when present",
        "output_key": "MonthEnd (renamed from Date index level)",
    },
    "target_next_month_up": {
        "return": "(Open_lead1 / Open) - 1 per Ticker, Open_lead1 = next row Open in time order",
        "class_1_if": f"return > {NEUTRAL_RETURN_BAND}",
        "class_neg1_if": f"return < -{NEUTRAL_RETURN_BAND}",
        "class_0_if": f"|return| <= {NEUTRAL_RETURN_BAND}",
        "missing_pdNA_when": "No next month (last ticker row) or undefined return",
        "neutral_return_band": NEUTRAL_RETURN_BAND,
    },
    "feature_list": [
        {
            "column": "open_pct_change_1m",
            "description": "1-month % change of Open within ticker",
            "formula": "groupby(Ticker) Open.pct_change(1)",
            "post_process": "clip to [-0.35, 0.35]",
        },
        {
            "column": "open_pct_change_3m",
            "description": "3-month % change of Open within ticker",
            "formula": "groupby(Ticker) Open.pct_change(3)",
            "post_process": "clip to [-0.7, 0.7]",
        },
        {
            "column": "open_pct_change_1m_lag1",
            "description": "Lag 1 of open_pct_change_1m",
            "formula": "groupby(Ticker) open_pct_change_1m.shift(1)",
        },
        {
            "column": "open_pct_change_1m_lag2",
            "formula": "groupby(Ticker) open_pct_change_1m.shift(2)",
        },
        {
            "column": "open_pct_change_1m_lag3",
            "formula": "groupby(Ticker) open_pct_change_1m.shift(3)",
        },
        {
            "column": "open_ret_roll_mean_3",
            "formula": "rolling mean window=3 on open_pct_change_1m, per ticker",
        },
        {
            "column": "open_ret_roll_std_3",
            "formula": "rolling std window=3 on open_pct_change_1m, per ticker",
        },
        {
            "column": "open_ret_roll_mean_6",
            "formula": "rolling mean window=6 on open_pct_change_1m, per ticker",
        },
        {
            "column": "open_ret_roll_std_6",
            "formula": "rolling std window=6 on open_pct_change_1m, per ticker",
        },
        {
            "column": "open_ret_sign_sum_3",
            "formula": "sum of sign(open_pct_change_1m) over rolling 3 months, per ticker",
        },
        {
            "column": "open_ret_abs_mean_3",
            "formula": "mean of abs(open_pct_change_1m) over rolling 3, per ticker",
        },
        {
            "column": "open_ret_roll_z_6",
            "formula": "(open_pct_change_1m - open_ret_roll_mean_6) / (open_ret_roll_std_6 + 1e-6)",
        },
        {
            "column": "open_vs_roll3",
            "formula": "(Open / rolling_mean(Open,3)) - 1 per ticker",
        },
        {
            "column": "open_vs_roll6",
            "formula": "(Open / rolling_mean(Open,6)) - 1 per ticker",
        },
        {
            "column": "open_vs_roll9",
            "formula": "(Open / rolling_mean(Open,9)) - 1 per ticker",
        },
        {
            "column": "hl_range_over_open",
            "formula": "(High-Low)/Open clipped [0, 0.6]; intramonth range vs open",
        },
        {
            "column": "close_over_open_ret",
            "formula": "(Close/Open)-1 clipped [-0.25, 0.25]",
        },
        {
            "column": "close_pct_change_1m",
            "formula": "groupby(Ticker) Close.pct_change(1) clipped like open 1m",
        },
        {
            "column": "close_pct_change_3m",
            "formula": "groupby(Ticker) Close.pct_change(3) clipped",
        },
        {
            "column": "close_vs_roll6",
            "formula": "(Close / rolling_mean(Close,6)) - 1 per ticker",
        },
        {
            "column": "volume_log1p",
            "formula": "log1p(max(Volume,0)) per row",
        },
        {
            "column": "volume_pct_change_1m",
            "formula": "pct_change on volume_log1p within ticker, clipped",
        },
        {
            "column": "volume_roll_z_6",
            "formula": "z-score of volume_log1p vs 6-month rolling mean/std per ticker",
        },
    ],
    "model_uses_columns": FEATURE_COLS,
    "notes": "All rolling/shift/pct_change are computed within each Ticker group. Training drops rows with NA in any of FEATURE_COLS or next_month_up.",
}

_pipeline_log_fp: Optional[TextIO] = None


def _dataframe_schema_snapshot(df: pd.DataFrame) -> Dict[str, Any]:
    return {
        "n_rows": int(len(df)),
        "n_columns": int(len(df.columns)),
        "columns": [str(c) for c in df.columns],
        "dtypes": {str(c): str(df[c].dtype) for c in df.columns},
    }


def _numeric_feature_summary(df: pd.DataFrame, cols: list[str]) -> Dict[str, Any]:
    use = [c for c in cols if c in df.columns]
    if not use:
        return {}
    desc = df[use].describe().T
    out: Dict[str, Any] = {}
    for col in use:
        row = desc.loc[col]
        out[col] = {
            "count": float(row["count"]) if pd.notna(row["count"]) else None,
            "mean": float(row["mean"]) if pd.notna(row["mean"]) else None,
            "std": float(row["std"]) if pd.notna(row["std"]) else None,
            "min": float(row["min"]) if pd.notna(row["min"]) else None,
            "max": float(row["max"]) if pd.notna(row["max"]) else None,
        }
    return out


def _multiclass_brier_score(y_true: np.ndarray, proba: np.ndarray, classes: np.ndarray) -> Optional[float]:
    try:
        cls_sorted = np.sort(classes)
        col_order = [int(np.where(classes == c)[0][0]) for c in cls_sorted]
        p_ordered = proba[:, col_order]
        y_oh = label_binarize(y_true, classes=cls_sorted)
        if y_oh.shape[1] <= 1:
            return None
        return float(np.mean(np.sum((y_oh - p_ordered) ** 2, axis=1)))
    except Exception:
        return None


def _probability_diagnostics(
    y_true: np.ndarray, proba: np.ndarray, classes: np.ndarray
) -> Dict[str, Any]:
    yt = np.asarray(y_true)
    idx_map = {int(c): int(np.where(classes == c)[0][0]) for c in classes}
    per_class: Dict[str, Any] = {}
    for c in sorted(int(x) for x in classes):
        mask = yt == c
        n = int(mask.sum())
        if n == 0:
            per_class[str(c)] = {"n": 0, "mean_pred_prob_true_class": None}
            continue
        col = idx_map[c]
        pc = proba[mask, col]
        per_class[str(c)] = {
            "n": n,
            "mean_pred_prob_for_true_class": float(np.mean(pc)),
            "std_pred_prob_for_true_class": float(np.std(pc)),
        }
    maxp = np.max(proba, axis=1)
    ent = -np.sum(proba * np.log(proba + 1e-15), axis=1)
    return {
        "per_true_class": per_class,
        "mean_max_predicted_prob": float(np.mean(maxp)),
        "median_max_predicted_prob": float(np.median(maxp)),
        "p90_max_predicted_prob": float(np.quantile(maxp, 0.9)),
        "mean_prediction_entropy": float(np.mean(ent)),
        "fraction_max_prob_ge_0.5": float(np.mean(maxp >= 0.5)),
        "fraction_max_prob_ge_0.7": float(np.mean(maxp >= 0.7)),
    }


def _classification_metrics_block(
    y_true: np.ndarray, y_pred: np.ndarray, proba: np.ndarray, classes: np.ndarray
) -> Dict[str, Any]:
    labels = np.sort(classes)
    yt = np.asarray(y_true)
    yp = np.asarray(y_pred)
    block: Dict[str, Any] = {
        "accuracy": float(accuracy_score(yt, yp)),
        "balanced_accuracy": float(balanced_accuracy_score(yt, yp)),
        "macro_f1": float(f1_score(yt, yp, average="macro", labels=labels, zero_division=0)),
        "weighted_f1": float(f1_score(yt, yp, average="weighted", labels=labels, zero_division=0)),
        "macro_precision": float(precision_score(yt, yp, average="macro", labels=labels, zero_division=0)),
        "weighted_precision": float(precision_score(yt, yp, average="weighted", labels=labels, zero_division=0)),
        "macro_recall": float(recall_score(yt, yp, average="macro", labels=labels, zero_division=0)),
        "weighted_recall": float(recall_score(yt, yp, average="weighted", labels=labels, zero_division=0)),
        "macro_jaccard": float(jaccard_score(yt, yp, average="macro", labels=labels, zero_division=0)),
        "cohen_kappa": float(cohen_kappa_score(yt, yp)),
        "matthews_corrcoef": float(matthews_corrcoef(yt, yp)),
    }
    prec = precision_score(yt, yp, labels=labels, average=None, zero_division=0)
    rec = recall_score(yt, yp, labels=labels, average=None, zero_division=0)
    f1 = f1_score(yt, yp, labels=labels, average=None, zero_division=0)
    block["per_class"] = {
        str(int(lbl)): {
            "precision": float(prec[i]),
            "recall": float(rec[i]),
            "f1": float(f1[i]),
        }
        for i, lbl in enumerate(labels)
    }
    try:
        block["log_loss"] = float(log_loss(yt, proba, labels=classes))
    except Exception:
        block["log_loss"] = None
    try:
        block["roc_auc_ovr_weighted"] = float(
            roc_auc_score(yt, proba, multi_class="ovr", average="weighted", labels=classes)
        )
    except Exception:
        block["roc_auc_ovr_weighted"] = None
    try:
        block["roc_auc_ovr_macro"] = float(
            roc_auc_score(yt, proba, multi_class="ovr", average="macro", labels=classes)
        )
    except Exception:
        block["roc_auc_ovr_macro"] = None
    block["multiclass_brier"] = _multiclass_brier_score(yt, proba, classes)
    block["probability_diagnostics"] = _probability_diagnostics(yt, proba, classes)
    return block


def _confusion_matrix_normalized(cm: np.ndarray) -> Dict[str, Any]:
    """Rows = true class, cols = predicted (same as sklearn confusion_matrix). Row-normalized recall."""
    cm = np.asarray(cm, dtype=float)
    row_sums = cm.sum(axis=1, keepdims=True)
    row_sums[row_sums == 0] = 1.0
    norm = cm / row_sums
    return {"counts": cm.tolist(), "row_normalized_recall_view": norm.round(6).tolist()}


def _dummy_baselines(train_df: pd.DataFrame, test_df: pd.DataFrame) -> Dict[str, Any]:
    X_train, y_train = train_df[FEATURE_COLS], train_df["next_month_up"]
    X_test, y_test = test_df[FEATURE_COLS], test_df["next_month_up"]
    out: Dict[str, Any] = {}
    for strategy in ("most_frequent", "stratified", "uniform"):
        dummy = DummyClassifier(strategy=strategy, random_state=GLOBAL_SEED)
        dummy.fit(X_train, y_train)
        pred = dummy.predict(X_test)
        out[strategy] = {
            "accuracy": float(accuracy_score(y_test, pred)),
            "balanced_accuracy": float(balanced_accuracy_score(y_test, pred)),
            "macro_f1": float(f1_score(y_test, pred, average="macro", zero_division=0)),
        }
    mode_cls = int(y_train.mode().iloc[0])
    out["always_predict_train_mode_class"] = mode_cls
    out["random_guess_3_class_expected_accuracy"] = round(1.0 / 3.0, 6)
    return out


def _feature_train_test_shift(train_df: pd.DataFrame, test_df: pd.DataFrame) -> Dict[str, Any]:
    rows: Dict[str, Any] = {}
    for c in FEATURE_COLS:
        tr = train_df[c].dropna()
        te = test_df[c].dropna()
        if len(tr) == 0 or len(te) == 0:
            rows[c] = None
            continue
        tr_m, te_m = float(tr.mean()), float(te.mean())
        rows[c] = {
            "train_mean": tr_m,
            "test_mean": te_m,
            "mean_diff_test_minus_train": te_m - tr_m,
            "train_std": float(tr.std()) if pd.notna(tr.std()) else None,
            "test_std": float(te.std()) if pd.notna(te.std()) else None,
        }
    return rows


def _optuna_study_diagnostics(study: optuna.study.Study) -> Dict[str, Any]:
    trials = study.trials
    complete = [t for t in trials if t.state == optuna.trial.TrialState.COMPLETE and t.value is not None]
    pruned = [t for t in trials if t.state == optuna.trial.TrialState.PRUNED]
    fail = [t for t in trials if t.state == optuna.trial.TrialState.FAIL]
    vals = [float(t.value) for t in complete]
    if not vals:
        return {
            "n_trials_total": len(trials),
            "n_complete": 0,
            "n_pruned": len(pruned),
            "n_fail": len(fail),
        }
    arr = np.array(vals, dtype=float)
    return {
        "n_trials_total": len(trials),
        "n_complete": len(complete),
        "n_pruned": len(pruned),
        "n_fail": len(fail),
        "best_value": float(study.best_value),
        "worst_complete_value": float(arr.min()),
        "median_complete_value": float(np.median(arr)),
        "mean_complete_value": float(np.mean(arr)),
        "std_complete_value": float(np.std(arr)) if len(arr) > 1 else 0.0,
        "q25_complete_value": float(np.quantile(arr, 0.25)),
        "q75_complete_value": float(np.quantile(arr, 0.75)),
    }


def pipeline_emit(phase: str, event: str, level: str = "INFO", **data: Any) -> None:
    if _pipeline_log_fp is None:
        return
    record = {
        "ts": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "level": level,
        "phase": phase,
        "event": event,
        "data": data,
    }
    _pipeline_log_fp.write(json.dumps(record, default=str) + "\n")
    _pipeline_log_fp.flush()


def open_pipeline_log(base_dir: Path) -> Path:
    global _pipeline_log_fp
    logs_dir = base_dir / "logs"
    logs_dir.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
    shortid = uuid.uuid4().hex[:8]
    log_path = logs_dir / f"run_{stamp}_{shortid}.jsonl"
    _pipeline_log_fp = open(log_path, "w", encoding="utf-8")
    return log_path.resolve()


def close_pipeline_log() -> None:
    global _pipeline_log_fp
    if _pipeline_log_fp is not None:
        _pipeline_log_fp.close()
        _pipeline_log_fp = None


def set_global_seed(seed: int = GLOBAL_SEED) -> None:
    random.seed(seed)
    np.random.seed(seed)


def daily_to_monthly(df: pd.DataFrame) -> pd.DataFrame:
    out = df.copy()
    out["Date"] = pd.to_datetime(out["Date"])
    out = out.sort_values(["Ticker", "Date"]).set_index("Date")
    agg_kwargs: Dict[str, tuple[str, str]] = {"Open": ("Open", "first")}
    if "High" in out.columns:
        agg_kwargs["High"] = ("High", "max")
    if "Low" in out.columns:
        agg_kwargs["Low"] = ("Low", "min")
    if "Close" in out.columns:
        agg_kwargs["Close"] = ("Close", "last")
    if "Volume" in out.columns:
        agg_kwargs["Volume"] = ("Volume", "sum")
    monthly = out.groupby(["Ticker", pd.Grouper(freq=MonthEnd())]).agg(**agg_kwargs).reset_index()
    return monthly.rename(columns={"Date": "MonthEnd"})


def ensure_ohlcv_columns(df: pd.DataFrame) -> pd.DataFrame:
    """Fill missing OHLCV so feature engineering can assume columns exist (Volume defaults to 0)."""
    d = df.copy()
    if "Open" not in d.columns:
        return d
    if "High" not in d.columns:
        d["High"] = d["Open"]
    else:
        d["High"] = d["High"].fillna(d["Open"])
    if "Low" not in d.columns:
        d["Low"] = d["Open"]
    else:
        d["Low"] = d["Low"].fillna(d["Open"])
    if "Close" not in d.columns:
        d["Close"] = d["Open"]
    else:
        d["Close"] = d["Close"].fillna(d["Open"])
    if "Volume" not in d.columns:
        d["Volume"] = 0.0
    else:
        d["Volume"] = d["Volume"].fillna(0.0)
    return d


def add_next_month_direction(monthly: pd.DataFrame) -> pd.DataFrame:
    out = monthly.sort_values(["Ticker", "MonthEnd"]).copy()
    next_open = out.groupby("Ticker")["Open"].shift(-1)
    next_return = (next_open / out["Open"]) - 1
    out["next_month_up"] = pd.Series(pd.NA, index=out.index, dtype="Int64")
    out.loc[next_return > NEUTRAL_RETURN_BAND, "next_month_up"] = 1
    out.loc[next_return < -NEUTRAL_RETURN_BAND, "next_month_up"] = -1
    out.loc[next_return.abs() <= NEUTRAL_RETURN_BAND, "next_month_up"] = 0
    out.loc[next_return.isna(), "next_month_up"] = pd.NA
    vc = out["next_month_up"].value_counts(dropna=False)
    label_counts: Dict[str, int] = {}
    for k, v in vc.items():
        if pd.isna(k):
            label_counts["NA"] = int(v)
        else:
            label_counts[str(int(k))] = int(v)
    pipeline_emit(
        "labels",
        "label_distribution",
        label_counts=label_counts,
        neutral_return_band=NEUTRAL_RETURN_BAND,
        label_definition=FEATURE_ENGINEERING_SPEC["target_next_month_up"],
    )
    return out


def add_open_price_features(monthly: pd.DataFrame) -> pd.DataFrame:
    out = ensure_ohlcv_columns(monthly.sort_values(["Ticker", "MonthEnd"]).copy())
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

    safe_open = out["Open"].replace(0, np.nan)
    out["hl_range_over_open"] = ((out["High"] - out["Low"]) / safe_open).clip(lower=0.0, upper=0.6)
    out["close_over_open_ret"] = ((out["Close"] / safe_open) - 1).clip(-0.25, 0.25)

    grouped_close = out.groupby("Ticker")["Close"]
    out["close_pct_change_1m"] = grouped_close.pct_change(1).clip(-0.35, 0.35)
    out["close_pct_change_3m"] = grouped_close.pct_change(3).clip(-0.7, 0.7)
    out["close_vs_roll6"] = (out["Close"] / grouped_close.transform(lambda s: s.rolling(window=6).mean())) - 1

    vol_nonneg = out.groupby("Ticker")["Volume"].transform(lambda s: np.maximum(s.astype(float), 0.0))
    out["volume_log1p"] = np.log1p(vol_nonneg)
    grouped_vlp = out.groupby("Ticker")["volume_log1p"]
    out["volume_pct_change_1m"] = (
        grouped_vlp.pct_change(1).replace([np.inf, -np.inf], np.nan).clip(-1.5, 1.5)
    )
    vol_m6 = grouped_vlp.transform(lambda s: s.rolling(window=6).mean())
    vol_s6 = grouped_vlp.transform(lambda s: s.rolling(window=6).std())
    out["volume_roll_z_6"] = (out["volume_log1p"] - vol_m6) / (vol_s6 + 1e-6)

    feat_dtypes = {c: str(out[c].dtype) for c in FEATURE_COLS if c in out.columns}
    pipeline_emit(
        "features",
        "open_price_features_computed",
        rows=len(out),
        n_tickers=int(out["Ticker"].nunique()),
        month_end_min=str(out["MonthEnd"].min()),
        month_end_max=str(out["MonthEnd"].max()),
        feature_column_dtypes=feat_dtypes,
        feature_value_summary=_numeric_feature_summary(out, FEATURE_COLS),
        open_level_summary=_numeric_feature_summary(out, ["Open"]) if "Open" in out.columns else {},
    )
    return out


def load_monthly_dataset(base_dir: Path) -> pd.DataFrame:
    monthly_path = base_dir / "df_nasdaq_monthly.csv"
    eod_path = base_dir / "df_nasdaq_eod.csv"

    if monthly_path.exists():
        df_monthly = ensure_ohlcv_columns(pd.read_csv(monthly_path))
        source_kind = "monthly_csv"
        source_path = str(monthly_path.resolve())
        pipeline_emit(
            "load",
            "csv_read_profile",
            source_kind=source_kind,
            source_path=source_path,
            **_dataframe_schema_snapshot(df_monthly),
        )
    elif eod_path.exists():
        df_eod = pd.read_csv(eod_path)
        source_kind = "eod_csv"
        source_path = str(eod_path.resolve())
        if "Date" in df_eod.columns:
            _dt = pd.to_datetime(df_eod["Date"])
            date_min = str(_dt.min())
            date_max = str(_dt.max())
        else:
            date_min, date_max = None, None
        pipeline_emit(
            "load",
            "eod_daily_read_profile",
            source_path=source_path,
            **_dataframe_schema_snapshot(df_eod),
            daily_date_min=date_min,
            daily_date_max=date_max,
            expected_columns_for_resample=FEATURE_ENGINEERING_SPEC["eod_to_monthly"]["input_requires"],
        )
        eod_rows = len(df_eod)
        df_monthly = ensure_ohlcv_columns(daily_to_monthly(df_eod))
        pipeline_emit(
            "load",
            "eod_to_monthly_conversion",
            eod_rows=eod_rows,
            monthly_rows=len(df_monthly),
            monthly_schema=_dataframe_schema_snapshot(df_monthly),
            month_end_min=str(df_monthly["MonthEnd"].min()),
            month_end_max=str(df_monthly["MonthEnd"].max()),
            n_tickers=int(df_monthly["Ticker"].nunique()),
        )
    else:
        raise FileNotFoundError("Missing df_nasdaq_monthly.csv (or df_nasdaq_eod.csv fallback).")

    df_monthly["MonthEnd"] = pd.to_datetime(df_monthly["MonthEnd"])
    pipeline_emit(
        "load",
        "month_end_parsed",
        month_end_dtype=str(df_monthly["MonthEnd"].dtype),
        month_end_min=str(df_monthly["MonthEnd"].min()),
        month_end_max=str(df_monthly["MonthEnd"].max()),
    )
    out = add_next_month_direction(df_monthly)
    pipeline_emit(
        "load",
        "dataset_loaded",
        source_kind=source_kind,
        source_path=source_path,
        rows=len(out),
        month_end_min=str(out["MonthEnd"].min()),
        month_end_max=str(out["MonthEnd"].max()),
        n_tickers=int(out["Ticker"].nunique()),
        schema_after_labels=_dataframe_schema_snapshot(out),
    )
    return out


def build_model_dataset(df_monthly: pd.DataFrame) -> pd.DataFrame:
    pipeline_emit(
        "dataset",
        "before_feature_engineering_monthly_frame",
        **_dataframe_schema_snapshot(df_monthly),
        month_end_min=str(df_monthly["MonthEnd"].min()) if "MonthEnd" in df_monthly.columns else None,
        month_end_max=str(df_monthly["MonthEnd"].max()) if "MonthEnd" in df_monthly.columns else None,
        n_tickers=int(df_monthly["Ticker"].nunique()) if "Ticker" in df_monthly.columns else None,
    )
    featured = add_open_price_features(df_monthly)
    subset_cols = ["next_month_up", *FEATURE_COLS]
    nulls = featured[subset_cols].isna().sum().sort_values(ascending=False)
    top_nulls = {str(idx): int(val) for idx, val in nulls.items() if val > 0}
    rows_before = len(featured)
    model_df = featured.dropna(subset=subset_cols).copy()
    rows_after = len(model_df)
    pipeline_emit(
        "dataset",
        "rows_after_dropna",
        rows_before=rows_before,
        rows_after=rows_after,
        rows_dropped=rows_before - rows_after,
        null_counts_by_column=top_nulls,
        featured_frame_schema=_dataframe_schema_snapshot(featured),
        model_frame_schema_after_dropna=_dataframe_schema_snapshot(model_df),
        feature_value_summary_trainable_rows=_numeric_feature_summary(model_df, FEATURE_COLS),
    )
    model_df["next_month_up"] = model_df["next_month_up"].astype(int)
    return model_df


def time_split(
    model_df: pd.DataFrame,
    split_ratio: float = 0.8,
    min_test_months: int = 12,
    *,
    randomize_test_window: bool = False,
    split_seed: int = GLOBAL_SEED,
    min_train_months_left: int = 30,
) -> Tuple[pd.DataFrame, pd.DataFrame]:
    unique_months = sorted(model_df["MonthEnd"].unique())
    n_months = len(unique_months)
    if n_months < 3:
        raise ValueError("Not enough monthly data for train/test split.")

    if randomize_test_window:
        max_test = n_months - min_train_months_left
        if max_test < min_test_months:
            raise ValueError(
                f"Not enough history: need at least min_train_months_left ({min_train_months_left}) "
                f"+ min_test_months ({min_test_months}) calendar months."
            )
        low = min_test_months
        high = max(low, max_test)
        rng = np.random.default_rng(int(split_seed))
        test_months = int(rng.integers(low, high + 1))
    else:
        test_months = max(min_test_months, int(round(n_months * (1 - split_ratio))))
        test_months = min(max(1, test_months), n_months - 1)
    split_month = unique_months[-test_months]
    train_df = model_df[model_df["MonthEnd"] < split_month].copy()
    test_df = model_df[model_df["MonthEnd"] >= split_month].copy()
    if train_df.empty or test_df.empty:
        raise ValueError("Time split produced empty train or test set.")
    pipeline_emit(
        "split",
        "time_split",
        split_month=str(split_month),
        n_unique_months=n_months,
        n_test_months_window=test_months,
        split_ratio=split_ratio,
        min_test_months=min_test_months,
        randomize_test_window=randomize_test_window,
        split_seed=int(split_seed),
        min_train_months_left=min_train_months_left if randomize_test_window else None,
        train_rows=len(train_df),
        test_rows=len(test_df),
        train_month_min=str(train_df["MonthEnd"].min()),
        train_month_max=str(train_df["MonthEnd"].max()),
        test_month_min=str(test_df["MonthEnd"].min()),
        test_month_max=str(test_df["MonthEnd"].max()),
    )
    return train_df, test_df


def get_class_weight(train_df: pd.DataFrame) -> str | None:
    class_counts = train_df["next_month_up"].value_counts(normalize=True)
    return "balanced" if class_counts.min() < 0.28 else None


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
    classes = sorted(train_df["next_month_up"].unique())
    weights: Dict[int, float] = {int(cls): 1.0 for cls in classes}
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
    pipeline_emit(
        "balance",
        "class_distribution",
        class_counts={str(int(k)): int(class_counts[k]) for k in class_counts.index},
        class_ratios={str(int(k)): float(class_ratios[k]) for k in class_ratios.index},
        suggested_sklearn_class_weight=class_weight,
    )


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


def cross_validate_params(
    train_df: pd.DataFrame,
    params: Dict[str, Any],
    trial: optuna.trial.Trial | None = None,
    return_fold_details: bool = False,
) -> tuple[float, float] | tuple[float, float, list[float], list[dict[str, Any]]]:
    cv_splits = get_time_cv_splits(train_df)
    fold_scores: list[float] = []
    fold_accs: list[float] = []
    fold_rows: list[dict[str, Any]] = []
    for fold_idx, (train_fold, valid_fold) in enumerate(cv_splits):
        model = train_model(train_fold, params)
        y_pred = model.predict(valid_fold[FEATURE_COLS])
        yt = valid_fold["next_month_up"]
        fold_score = balanced_accuracy_score(yt, y_pred)
        fold_acc = float(accuracy_score(yt, y_pred))
        fold_scores.append(fold_score)
        fold_accs.append(fold_acc)
        if return_fold_details:
            proba_v = model.predict_proba(valid_fold[FEATURE_COLS])
            ll: Optional[float] = None
            try:
                ll = float(log_loss(yt, proba_v, labels=model.classes_))
            except ValueError:
                ll = None
            fold_rows.append(
                {
                    "fold_index": fold_idx,
                    "balanced_accuracy": float(fold_score),
                    "accuracy": float(accuracy_score(yt, y_pred)),
                    "macro_f1": float(f1_score(yt, y_pred, average="macro", zero_division=0)),
                    "weighted_f1": float(f1_score(yt, y_pred, average="weighted", zero_division=0)),
                    "log_loss_valid": ll,
                    "valid_rows": int(len(valid_fold)),
                    "train_rows": int(len(train_fold)),
                }
            )
        if trial is not None:
            intermediate_score = float(sum(fold_scores) / len(fold_scores))
            trial.report(intermediate_score, step=fold_idx)
            if trial.should_prune():
                raise optuna.exceptions.TrialPruned()
    mean_bal = float(sum(fold_scores) / len(fold_scores))
    mean_acc = float(sum(fold_accs) / len(fold_accs))
    if return_fold_details:
        return mean_bal, mean_acc, fold_scores, fold_rows
    return mean_bal, mean_acc


def tune_hyperparameters(
    train_df: pd.DataFrame, n_trials: int | None = None, early_stopping_patience: int = 10
) -> Dict[str, Any]:
    n_trials = 5  # hardcoded for now (ignores n_trials arg and adaptive rule)
    pipeline_emit(
        "tune",
        "hyperopt_start",
        n_trials=n_trials,
        early_stopping_patience=early_stopping_patience,
        train_rows=len(train_df),
        adaptive_n_trials_rule="disabled_hardcoded_5",
        optuna_objective_name="mean_time_series_cv_balanced_accuracy",
        optuna_objective_sklearn_metric="balanced_accuracy_score",
        optuna_objective_description=(
            "Mean of sklearn.metrics.balanced_accuracy_score on each time-based CV validation fold "
            "(unweighted mean of per-class recalls). Study direction=maximize. "
            "trial.value is this metric only—not accuracy, macro-F1, or log_loss."
        ),
        optuna_objective_sklearn_docs=(
            "https://scikit-learn.org/stable/modules/generated/sklearn.metrics.balanced_accuracy_score.html"
        ),
        parallel_logged_metric="mean_cv_accuracy",
        parallel_logged_metric_description=(
            "Same CV splits: mean of sklearn.metrics.accuracy_score per fold, stored as trial "
            "user_attrs and in logs for comparison to majority-class baselines (not optimized)."
        ),
    )
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
        mean_bal, mean_acc = cross_validate_params(
            train_df, params, trial=trial, return_fold_details=False
        )
        trial.set_user_attr("mean_cv_accuracy", mean_acc)
        return mean_bal

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
            n_complete = sum(
                1 for t in study.trials if t.state == optuna.trial.TrialState.COMPLETE
            )
            pipeline_emit(
                "tune",
                "early_stopping_triggered",
                no_improve_count=tracker["no_improve_count"],
                patience=early_stopping_patience,
                best_value=float(study.best_value),
                n_trials_completed=n_complete,
            )
            study.stop()

    def log_trial_callback(study: optuna.study.Study, trial: optuna.trial.FrozenTrial) -> None:
        payload: Dict[str, Any] = {
            "trial_number": trial.number,
            "state": trial.state.name,
            "value": trial.value,
            "params": dict(trial.params) if trial.params else {},
        }
        if trial.state == optuna.trial.TrialState.COMPLETE:
            payload["best_value_so_far"] = float(study.best_value)
        if "mean_cv_accuracy" in trial.user_attrs:
            payload["mean_cv_accuracy"] = float(trial.user_attrs["mean_cv_accuracy"])
        pipeline_emit("tune", "optuna_trial_complete", **payload)

    study = optuna.create_study(
        direction="maximize",
        sampler=optuna.samplers.TPESampler(seed=GLOBAL_SEED),
        pruner=optuna.pruners.MedianPruner(n_startup_trials=5, n_warmup_steps=2),
    )
    study.optimize(objective, n_trials=n_trials, callbacks=[log_trial_callback, early_stop_callback])

    best_trial = study.best_trial
    best_params: Dict[str, Any] = dict(best_trial.params)
    class_weight_mode = str(best_params.pop("class_weight_mode"))
    best_params["class_weight"] = class_weight_from_mode(train_df, class_weight_mode)
    best_params["random_state"] = GLOBAL_SEED
    best_params["n_jobs"] = -1

    cv_mean_bal, cv_mean_acc, fold_bal_scores, fold_rows = cross_validate_params(
        train_df, best_params, trial=None, return_fold_details=True
    )
    acc_per_fold = [float(fr["accuracy"]) for fr in fold_rows]
    pipeline_emit(
        "tune",
        "best_params_time_cv_fold_diagnostics",
        folds=fold_rows,
        balanced_accuracy_per_fold=[float(x) for x in fold_bal_scores],
        balanced_accuracy_mean=float(np.mean(fold_bal_scores)),
        balanced_accuracy_std=float(np.std(fold_bal_scores)),
        balanced_accuracy_min=float(np.min(fold_bal_scores)),
        balanced_accuracy_max=float(np.max(fold_bal_scores)),
        accuracy_per_fold=acc_per_fold,
        accuracy_mean=float(cv_mean_acc),
        accuracy_std=float(np.std(acc_per_fold)) if len(acc_per_fold) > 1 else 0.0,
        cv_objective_recomputed_mean_balanced_accuracy=float(cv_mean_bal),
        cv_recomputed_mean_accuracy=float(cv_mean_acc),
    )
    pipeline_emit(
        "tune",
        "hyperopt_complete",
        best_cv_balanced_accuracy=float(study.best_value),
        best_trial_mean_cv_accuracy=(
            float(best_trial.user_attrs["mean_cv_accuracy"])
            if "mean_cv_accuracy" in best_trial.user_attrs
            else None
        ),
        n_trials_total=len(study.trials),
        best_trial_number=best_trial.number,
        best_params=best_params,
        optuna_study_diagnostics=_optuna_study_diagnostics(study),
    )

    print("Best CV balanced accuracy:", round(study.best_value, 4))
    print("Completed Optuna trials:", len(study.trials))
    print("Best Optuna params:", best_params)
    return best_params


def train_classifier(
    train_df: pd.DataFrame, params: Dict[str, Any]
) -> RandomForestClassifier | ExtraTreesClassifier:
    return train_model(train_df, params)


def _class_label_human(c: int) -> str:
    return {-1: "down(-1)", 0: "neutral(0)", 1: "up(+1)"}.get(int(c), str(int(c)))


def _emit_run_end_readable_eval(
    test_df: pd.DataFrame,
    y_true: pd.Series,
    y_pred: pd.Series,
    proba_test: np.ndarray,
) -> Dict[str, Any]:
    """Emit JSONL digest: explained confusion matrix + concrete correct/wrong examples. Returns a small dict for artifacts."""
    labels = np.array([-1, 0, 1], dtype=int)
    cm3 = confusion_matrix(y_true, y_pred, labels=labels)
    header = [int(x) for x in labels]
    ascii_lines = ["(rows = true class, columns = predicted class; diagonal = correct for that true class)"]
    ascii_lines.append("           " + "  ".join(f"pred_{c}" for c in header))
    for i, ti in enumerate(header):
        row = "  ".join(str(int(cm3[i, j])).rjust(8) for j in range(len(header)))
        ascii_lines.append(f"true_{ti:>3}   {row}")
    ascii_sketch = "\n".join(ascii_lines)

    reset = test_df.reset_index(drop=True)
    yt = y_true.reset_index(drop=True).astype(int)
    yp = y_pred.reset_index(drop=True).astype(int)
    match = (yt.values == yp.values).astype(bool)
    max_p = np.max(proba_test, axis=1)
    examples: list[Dict[str, Any]] = []
    for k in range(len(reset)):
        examples.append(
            {
                "Ticker": str(reset.loc[k, "Ticker"]),
                "MonthEnd": str(reset.loc[k, "MonthEnd"]),
                "actual_class": int(yt.iloc[k]),
                "actual_label": _class_label_human(int(yt.iloc[k])),
                "predicted_class": int(yp.iloc[k]),
                "predicted_label": _class_label_human(int(yp.iloc[k])),
                "was_correct": bool(match[k]),
                "confidence_max_class_prob": round(float(max_p[k]), 4),
            }
        )
    correct_examples = [e for e in examples if e["was_correct"]][:15]
    wrong_examples = [e for e in examples if not e["was_correct"]][:15]
    n_ok = int(match.sum())
    n_bad = int(len(match) - n_ok)
    acc = float(n_ok / len(match)) if len(match) else None

    pipeline_emit(
        "eval",
        "run_end_confusion_matrix_explained",
        columns_predicted_class=header,
        rows_true_class=header,
        counts_matrix_row_major=cm3.tolist(),
        interpretation=(
            "counts_matrix_row_major[i][j] = number of test rows where true_class==rows_true_class[i] "
            "and predicted_class==columns_predicted_class[j]. Diagonal = correct for that true class."
        ),
        confusion_ascii_sketch=ascii_sketch,
        per_true_class_row_totals={str(int(labels[i])): int(cm3[i].sum()) for i in range(len(labels))},
        per_pred_class_column_totals={str(int(labels[j])): int(cm3[:, j].sum()) for j in range(len(labels))},
    )
    pipeline_emit(
        "eval",
        "run_end_prediction_examples",
        n_test_rows=len(reset),
        n_correct=n_ok,
        n_wrong=n_bad,
        headline_accuracy_plain=acc,
        examples_correct_up_to_15=correct_examples,
        examples_wrong_up_to_15=wrong_examples,
        how_to_read_wrong_examples=(
            "Each wrong row: actual_* is the real next-month label; predicted_* is what the model chose. "
            "confidence_max_class_prob is max softmax probability among classes."
        ),
    )
    return {
        "confusion_matrix_3x3": cm3.tolist(),
        "confusion_ascii_sketch": ascii_sketch,
        "n_correct": n_ok,
        "n_wrong": n_bad,
        "headline_accuracy_plain": acc,
        "examples_correct_up_to_15": correct_examples,
        "examples_wrong_up_to_15": wrong_examples,
    }


def evaluate_classifier(
    model: RandomForestClassifier | ExtraTreesClassifier,
    test_df: pd.DataFrame,
    train_df: pd.DataFrame | None = None,
) -> Tuple[pd.Series, pd.DataFrame, Dict[str, Any]]:
    y_true = test_df["next_month_up"]
    X_test = test_df[FEATURE_COLS]
    y_pred = pd.Series(model.predict(X_test), index=test_df.index)
    proba_test = model.predict_proba(X_test)
    classes = model.classes_

    test_block = _classification_metrics_block(
        np.asarray(y_true), np.asarray(y_pred.values), proba_test, classes
    )
    recalls = recall_score(y_true, y_pred, labels=[-1, 0, 1], average=None, zero_division=0)

    accuracy = float(test_block["accuracy"])
    balanced_acc = float(test_block["balanced_accuracy"])
    macro_f1 = float(test_block["macro_f1"])

    print("Accuracy:", round(accuracy, 4))
    print("Balanced accuracy:", round(balanced_acc, 4))
    print("Macro F1:", round(macro_f1, 4))
    print("Cohen kappa:", round(float(test_block["cohen_kappa"]), 4))
    if test_block.get("log_loss") is not None:
        print("Log loss:", round(float(test_block["log_loss"]), 4))
    if test_block.get("roc_auc_ovr_weighted") is not None:
        print("ROC-AUC OVR weighted:", round(float(test_block["roc_auc_ovr_weighted"]), 4))
    print("Recall class -1 (down):", round(float(recalls[0]), 4))
    print("Recall class 0 (neutral):", round(float(recalls[1]), 4))
    print("Recall class 1 (up):", round(float(recalls[2]), 4))
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

    pc = test_block.get("per_class", {})
    metrics: Dict[str, Any] = {
        "accuracy": accuracy,
        "balanced_accuracy": balanced_acc,
        "macro_f1": macro_f1,
        "recall_class_neg1": float(recalls[0]),
        "recall_class_0": float(recalls[1]),
        "recall_class_1": float(recalls[2]),
    }
    cm = confusion_matrix(y_true, y_pred)
    cm_entry = _confusion_matrix_normalized(cm)

    diagnostics: Dict[str, Any] = {
        "test_full_metrics": test_block,
        "confusion_matrix": cm_entry,
        "classification_report": classification_report(y_true, y_pred, digits=4, output_dict=True),
        "feature_importance_full": importance.to_dict(orient="records"),
    }

    if train_df is not None:
        X_tr = train_df[FEATURE_COLS]
        y_tr = train_df["next_month_up"]
        y_pred_tr = model.predict(X_tr)
        proba_tr = model.predict_proba(X_tr)
        train_block = _classification_metrics_block(
            np.asarray(y_tr), np.asarray(y_pred_tr), proba_tr, classes
        )
        diagnostics["train_in_sample_metrics"] = train_block
        diagnostics["train_vs_test_gap"] = {
            "balanced_accuracy_train_minus_test": float(train_block["balanced_accuracy"])
            - float(test_block["balanced_accuracy"]),
            "accuracy_train_minus_test": float(train_block["accuracy"]) - float(test_block["accuracy"]),
            "macro_f1_train_minus_test": float(train_block["macro_f1"]) - float(test_block["macro_f1"]),
            "log_loss_train_minus_test": (
                (float(train_block["log_loss"]) - float(test_block["log_loss"]))
                if train_block.get("log_loss") is not None and test_block.get("log_loss") is not None
                else None
            ),
        }
        diagnostics["dummy_baselines_on_test"] = _dummy_baselines(train_df, test_df)
        diagnostics["feature_train_test_mean_shift"] = _feature_train_test_shift(train_df, test_df)

    metrics["diagnostics"] = diagnostics

    headline = {
        k: metrics[k]
        for k in (
            "accuracy",
            "balanced_accuracy",
            "macro_f1",
            "recall_class_neg1",
            "recall_class_0",
            "recall_class_1",
        )
    }
    pipeline_emit(
        "eval",
        "metrics",
        test_headline=headline,
        diagnostics=diagnostics,
        confusion_matrix_counts=cm_entry["counts"],
        confusion_matrix_row_normalized=cm_entry["row_normalized_recall_view"],
        feature_importance_top5=importance.head(5).to_dict(orient="records"),
    )
    readable_digest = _emit_run_end_readable_eval(test_df, y_true, y_pred, proba_test)
    diagnostics["readable_run_end"] = readable_digest
    return y_pred, importance, metrics


def run_pipeline(
    base_dir: Path,
    *,
    randomize_test_window: bool = True,
    split_seed: int | None = None,
    min_train_months_left: int = 30,
    min_test_months: int = 12,
) -> None:
    set_global_seed(GLOBAL_SEED)
    started_at = time.time()
    split_seed_eff = int(split_seed if split_seed is not None else GLOBAL_SEED)
    log_path: Optional[Path] = None
    try:
        log_path = open_pipeline_log(base_dir)
        pipeline_emit(
            "init",
            "pipeline_start",
            seed=GLOBAL_SEED,
            base_dir=str(base_dir.resolve()),
            log_path=str(log_path),
            feature_columns_ordered=FEATURE_COLS,
            feature_engineering_spec=FEATURE_ENGINEERING_SPEC,
            randomize_test_window=randomize_test_window,
            split_seed=split_seed_eff,
            min_train_months_left=min_train_months_left,
            min_test_months_floor=min_test_months,
        )

        df_monthly = load_monthly_dataset(base_dir)
        model_df = build_model_dataset(df_monthly)
        train_df, test_df = time_split(
            model_df,
            split_ratio=0.8,
            min_test_months=min_test_months,
            randomize_test_window=randomize_test_window,
            split_seed=split_seed_eff,
            min_train_months_left=min_train_months_left,
        )

        print(
            "Train/test split:",
            "randomized window" if randomize_test_window else "fixed ratio",
            f"seed={split_seed_eff}",
        )
        print("Train rows:", len(train_df), "Test rows:", len(test_df))
        print("Train month range:", train_df["MonthEnd"].min(), "to", train_df["MonthEnd"].max())
        print("Test month range:", test_df["MonthEnd"].min(), "to", test_df["MonthEnd"].max())
        print_class_balance(train_df)

        best_params = tune_hyperparameters(train_df)
        pipeline_emit(
            "train",
            "final_model_fit_start",
            train_rows=len(train_df),
            model_type=best_params["model_type"],
        )
        model = train_classifier(train_df, best_params)
        pipeline_emit("train", "final_model_fitted", train_rows=len(train_df), model_type=best_params["model_type"])

        y_pred, importance, metrics = evaluate_classifier(model, test_df, train_df=train_df)

        predictions_df = test_df[["Ticker", "MonthEnd", "next_month_up"]].copy()
        predictions_df["pred_next_month_up"] = y_pred.values
        proba = model.predict_proba(test_df[FEATURE_COLS])
        class_to_col = {-1: "pred_prob_neg1", 0: "pred_prob_0", 1: "pred_prob_1"}
        for idx, cls in enumerate(model.classes_):
            col_name = class_to_col.get(int(cls), f"pred_prob_class_{int(cls)}")
            predictions_df[col_name] = proba[:, idx]
        predictions_path = base_dir / "next_month_up_predictions.csv"
        predictions_df.to_csv(predictions_path, index=False)

        featured_df = add_open_price_features(df_monthly)
        features_path = base_dir / "df_nasdaq_monthly_features.csv"
        featured_df.to_csv(features_path, index=False)

        elapsed_seconds = round(time.time() - started_at, 2)
        metrics["runtime_seconds"] = elapsed_seconds
        print("Runtime seconds:", elapsed_seconds)

        artifacts_path = base_dir / "next_month_up_training_artifacts.json"
        artifacts = {
            "seed": GLOBAL_SEED,
            "split_config": {
                "randomize_test_window": randomize_test_window,
                "split_seed": split_seed_eff,
                "min_train_months_left": min_train_months_left,
                "min_test_months_floor": min_test_months,
                "n_train_calendar_months": int(train_df["MonthEnd"].nunique()),
                "n_test_calendar_months": int(test_df["MonthEnd"].nunique()),
            },
            "best_params": best_params,
            "metrics": metrics,
            "feature_cols": FEATURE_COLS,
            "feature_importance": importance.to_dict(orient="records"),
        }
        with open(artifacts_path, "w", encoding="utf-8") as f:
            json.dump(artifacts, f, indent=2, default=str)

        pipeline_emit(
            "export",
            "artifacts_written",
            predictions_csv=str(predictions_path.resolve()),
            monthly_features_csv=str(features_path.resolve()),
            training_artifacts_json=str(artifacts_path.resolve()),
        )
        pipeline_emit(
            "summary",
            "run_finished_where_to_look",
            message=(
                "End-of-run human-readable eval is in JSONL events: "
                "eval/run_end_confusion_matrix_explained and eval/run_end_prediction_examples; "
                "also duplicated under metrics.diagnostics.readable_run_end in the artifacts JSON."
            ),
            test_accuracy=metrics.get("accuracy"),
            test_balanced_accuracy=metrics.get("balanced_accuracy"),
            predictions_csv=str(predictions_path.resolve()),
            training_artifacts_json=str(artifacts_path.resolve()),
        )
        pipeline_emit(
            "done",
            "pipeline_complete",
            runtime_seconds=elapsed_seconds,
            log_path=str(log_path) if log_path is not None else None,
            predictions_csv=str(predictions_path.resolve()),
            monthly_features_csv=str(features_path.resolve()),
            training_artifacts_json=str(artifacts_path.resolve()),
        )
    except Exception as e:
        pipeline_emit(
            "init",
            "exception",
            level="ERROR",
            message=repr(e),
            traceback=traceback.format_exc(),
        )
        raise
    finally:
        close_pipeline_log()


if __name__ == "__main__":
    run_pipeline(Path("."))
