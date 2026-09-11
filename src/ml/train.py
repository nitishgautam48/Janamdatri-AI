"""
Train a maternal health risk classifier on the UCI Maternal Health Risk
Data Set (Age, SystolicBP, DiastolicBP, BS, BodyTemp, HeartRate -> RiskLevel).

This is the real, data-driven ML component: unlike hand-set clinical
thresholds, the model LEARNS the decision boundary from ~1014 labeled
records collected via an IoT risk-monitoring system across rural
Bangladeshi clinics (UCI dataset DOI: 10.24432/C5DP5D).

It only covers what that dataset covers - vitals-driven risk (hypertension/
blood-sugar/temperature/heart-rate patterns). It says nothing about
symptoms the dataset never recorded (bleeding, fetal movement, obstructed
labor) - those are handled by the separate rule-based dynamic-evaluation
layer in src/dynamic_eval/, combined with this model's output in
src/dynamic_eval/triage.py. Neither layer alone is a diagnosis.

Run: python -m src.ml.train
"""

import joblib
import numpy as np
import pandas as pd
from pathlib import Path
from sklearn.ensemble import RandomForestClassifier
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import accuracy_score, classification_report, f1_score
from sklearn.model_selection import train_test_split
from sklearn.preprocessing import StandardScaler

DATA_PATH = Path(__file__).resolve().parents[2] / "data" / "maternal_health_risk.csv"
MODEL_DIR = Path(__file__).resolve().parents[2] / "models"
FEATURES = ["Age", "SystolicBP", "DiastolicBP", "BS", "BodyTemp", "HeartRate"]
RISK_ORDER = ["low risk", "mid risk", "high risk"]


def load_dataset():
    df = pd.read_csv(DATA_PATH)
    df.columns = [c.strip() for c in df.columns]
    df["RiskLevel"] = df["RiskLevel"].str.strip().str.lower()
    df = df[df["RiskLevel"].isin(RISK_ORDER)].dropna()
    return df


def train():
    df = load_dataset()
    X = df[FEATURES]
    y = df["RiskLevel"].map({label: i for i, label in enumerate(RISK_ORDER)})

    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=0.2, random_state=42, stratify=y
    )

    scaler = StandardScaler()
    X_train_scaled = scaler.fit_transform(X_train)
    X_test_scaled = scaler.transform(X_test)

    candidates = {
        "logistic_regression": LogisticRegression(max_iter=1000),
        "random_forest": RandomForestClassifier(
            n_estimators=300, max_depth=None, random_state=42, class_weight="balanced"
        ),
    }

    best_name, best_model, best_f1 = None, None, -1.0
    for name, model in candidates.items():
        model.fit(X_train_scaled, y_train)
        preds = model.predict(X_test_scaled)
        f1 = f1_score(y_test, preds, average="macro")
        acc = accuracy_score(y_test, preds)
        print(f"\n=== {name} ===")
        print(f"Accuracy: {acc:.3f}  Macro F1: {f1:.3f}")
        print(classification_report(y_test, preds, target_names=RISK_ORDER))
        if f1 > best_f1:
            best_name, best_model, best_f1 = name, model, f1

    print(f"\nSelected model: {best_name} (macro F1 = {best_f1:.3f})")

    MODEL_DIR.mkdir(exist_ok=True)
    joblib.dump(
        {
            "model": best_model,
            "scaler": scaler,
            "features": FEATURES,
            "risk_order": RISK_ORDER,
            "model_name": best_name,
            "test_accuracy": float(accuracy_score(y_test, best_model.predict(X_test_scaled))),
            "test_macro_f1": float(best_f1),
        },
        MODEL_DIR / "risk_classifier.joblib",
    )
    print(f"Saved model to {MODEL_DIR / 'risk_classifier.joblib'}")


if __name__ == "__main__":
    train()
