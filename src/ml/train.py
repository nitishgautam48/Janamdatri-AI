"""
Train a maternal health risk classifier on the UCI Maternal Health Risk
Data Set (Age, SystolicBP, DiastolicBP, BS, BodyTemp, HeartRate -> RiskLevel),
enriched with an engineered Mean Arterial Pressure feature (see features.py).

Methodology notes (this is the "how do we know the model is actually any
good" layer, not just a single lucky train/test split):
 - StandardScaler + classifier are wrapped in one sklearn Pipeline, so
   cross-validation refits the scaler on each fold's training data only.
   Fitting the scaler on the full dataset before splitting - a common
   mistake - leaks each held-out fold's mean/variance into training and
   quietly inflates reported scores.
 - 5-fold stratified cross-validation on the training split is used for
   MODEL SELECTION (which of logistic regression / random forest to keep),
   because a single train/test split's score is noisy with ~1000 rows.
 - The held-out test split (never touched during CV or model selection)
   gives the final, reported accuracy/F1 - this is what ships in the
   saved model bundle and what the UI shows.
 - Feature importances are saved so the API can expose *why* the model
   weighs a prediction the way it does (see /model/info) rather than
   being a black box.

Run: python -m src.ml.train
"""

import joblib
import pandas as pd
from pathlib import Path
from sklearn.ensemble import RandomForestClassifier
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import accuracy_score, classification_report, f1_score
from sklearn.model_selection import StratifiedKFold, cross_val_score, train_test_split
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler

from .features import ALL_FEATURES

DATA_PATH = Path(__file__).resolve().parents[2] / "data" / "maternal_health_risk.csv"
MODEL_DIR = Path(__file__).resolve().parents[2] / "models"
RISK_ORDER = ["low risk", "mid risk", "high risk"]


def load_dataset() -> pd.DataFrame:
    df = pd.read_csv(DATA_PATH)
    df.columns = [c.strip() for c in df.columns]
    df["RiskLevel"] = df["RiskLevel"].str.strip().str.lower()
    df = df[df["RiskLevel"].isin(RISK_ORDER)].dropna()
    # Mean Arterial Pressure - see features.py. Computed once here on the
    # whole frame (a pure arithmetic transform of raw columns, not a
    # statistic fit on data - so, unlike the scaler, there's no leakage
    # concern in computing it before the train/test split).
    df["MAP"] = df["DiastolicBP"] + (df["SystolicBP"] - df["DiastolicBP"]) / 3
    return df


def train():
    df = load_dataset()
    X = df[ALL_FEATURES]
    y = df["RiskLevel"].map({label: i for i, label in enumerate(RISK_ORDER)})

    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=0.2, random_state=42, stratify=y
    )

    candidates = {
        "logistic_regression": Pipeline([
            ("scaler", StandardScaler()),
            ("clf", LogisticRegression(max_iter=1000)),
        ]),
        "random_forest": Pipeline([
            ("scaler", StandardScaler()),
            ("clf", RandomForestClassifier(n_estimators=300, random_state=42, class_weight="balanced")),
        ]),
    }

    cv = StratifiedKFold(n_splits=5, shuffle=True, random_state=42)

    best_name = best_pipeline = None
    best_cv_mean = -1.0
    best_cv_std = best_test_acc = best_test_f1 = 0.0

    for name, pipeline in candidates.items():
        cv_scores = cross_val_score(pipeline, X_train, y_train, cv=cv, scoring="f1_macro")

        pipeline.fit(X_train, y_train)
        preds = pipeline.predict(X_test)
        test_acc = accuracy_score(y_test, preds)
        test_f1 = f1_score(y_test, preds, average="macro")

        print(f"\n=== {name} ===")
        print(f"5-fold CV macro F1 (train split only): {cv_scores.mean():.3f} +/- {cv_scores.std():.3f}")
        print(f"Held-out test accuracy: {test_acc:.3f}  Held-out test macro F1: {test_f1:.3f}")
        print(classification_report(y_test, preds, target_names=RISK_ORDER))

        if cv_scores.mean() > best_cv_mean:
            best_name, best_pipeline = name, pipeline
            best_cv_mean, best_cv_std = cv_scores.mean(), cv_scores.std()
            best_test_acc, best_test_f1 = test_acc, test_f1

    print(f"\nSelected model: {best_name} (5-fold CV macro F1 = {best_cv_mean:.3f} +/- {best_cv_std:.3f})")

    feature_importances = None
    clf = best_pipeline.named_steps["clf"]
    if hasattr(clf, "feature_importances_"):
        feature_importances = dict(zip(ALL_FEATURES, (float(v) for v in clf.feature_importances_)))
        print("Feature importances:", feature_importances)

    MODEL_DIR.mkdir(exist_ok=True)
    joblib.dump(
        {
            "pipeline": best_pipeline,
            "features": ALL_FEATURES,
            "risk_order": RISK_ORDER,
            "model_name": best_name,
            "test_accuracy": float(best_test_acc),
            "test_macro_f1": float(best_test_f1),
            "cv_macro_f1_mean": float(best_cv_mean),
            "cv_macro_f1_std": float(best_cv_std),
            "feature_importances": feature_importances,
        },
        MODEL_DIR / "risk_classifier.joblib",
    )
    print(f"Saved model to {MODEL_DIR / 'risk_classifier.joblib'}")


if __name__ == "__main__":
    train()
