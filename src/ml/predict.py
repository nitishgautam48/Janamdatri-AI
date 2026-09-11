"""
Loads the trained risk classifier (see train.py) and runs inference on a
single set of vitals. Kept separate from train.py so the API layer never
needs scikit-learn's training-time dependencies loaded at request time.
"""

from pathlib import Path
from functools import lru_cache

import joblib
import numpy as np

MODEL_PATH = Path(__file__).resolve().parents[2] / "models" / "risk_classifier.joblib"


class RiskClassifier:
    def __init__(self, model_path: Path = MODEL_PATH):
        if not model_path.exists():
            raise FileNotFoundError(
                f"No trained model found at {model_path}. Run `python -m src.ml.train` first."
            )
        bundle = joblib.load(model_path)
        self.model = bundle["model"]
        self.scaler = bundle["scaler"]
        self.features = bundle["features"]
        self.risk_order = bundle["risk_order"]
        self.model_name = bundle["model_name"]
        self.test_accuracy = bundle["test_accuracy"]
        self.test_macro_f1 = bundle["test_macro_f1"]

    def predict(self, vitals: dict) -> dict:
        missing = [f for f in self.features if vitals.get(f) is None]
        if missing:
            raise ValueError(f"Missing required vitals for ML prediction: {missing}")

        row = np.array([[vitals[f] for f in self.features]], dtype=float)
        row_scaled = self.scaler.transform(row)

        predicted_idx = int(self.model.predict(row_scaled)[0])
        probabilities = self.model.predict_proba(row_scaled)[0]

        return {
            "riskLevel": self.risk_order[predicted_idx],
            "probabilities": {
                label: float(prob) for label, prob in zip(self.risk_order, probabilities)
            },
            "modelName": self.model_name,
            "modelTestAccuracy": self.test_accuracy,
            "modelTestMacroF1": self.test_macro_f1,
        }


@lru_cache(maxsize=1)
def get_classifier() -> RiskClassifier:
    return RiskClassifier()
