"""
Loads the trained risk classifier (see train.py) and runs inference on a
single set of vitals. Kept separate from train.py so the API layer never
needs scikit-learn's training-time dependencies loaded at request time.
"""

from pathlib import Path
from functools import lru_cache

import numpy as np
import joblib

from .features import BASE_FEATURES, add_engineered_features

MODEL_PATH = Path(__file__).resolve().parents[2] / "models" / "risk_classifier.joblib"


class RiskClassifier:
    def __init__(self, model_path: Path = MODEL_PATH):
        if not model_path.exists():
            raise FileNotFoundError(
                f"No trained model found at {model_path}. Run `python -m src.ml.train` first."
            )
        bundle = joblib.load(model_path)
        self.pipeline = bundle["pipeline"]
        self.features = bundle["features"]
        self.risk_order = bundle["risk_order"]
        self.model_name = bundle["model_name"]
        self.test_accuracy = bundle["test_accuracy"]
        self.test_macro_f1 = bundle["test_macro_f1"]
        self.cv_macro_f1_mean = bundle.get("cv_macro_f1_mean")
        self.cv_macro_f1_std = bundle.get("cv_macro_f1_std")
        self.feature_importances = bundle.get("feature_importances")
        self.best_params = bundle.get("best_params")

    def predict(self, vitals: dict) -> dict:
        missing = [f for f in BASE_FEATURES if vitals.get(f) is None]
        if missing:
            raise ValueError(f"Missing required vitals for ML prediction: {missing}")

        enriched = add_engineered_features(vitals)
        row = np.array([[enriched[f] for f in self.features]], dtype=float)

        predicted_idx = int(self.pipeline.predict(row)[0])
        probabilities = self.pipeline.predict_proba(row)[0]

        return {
            "riskLevel": self.risk_order[predicted_idx],
            "probabilities": {
                label: float(prob) for label, prob in zip(self.risk_order, probabilities)
            },
            "modelName": self.model_name,
            "modelTestAccuracy": self.test_accuracy,
            "modelTestMacroF1": self.test_macro_f1,
            "modelCvMacroF1Mean": self.cv_macro_f1_mean,
            "modelCvMacroF1Std": self.cv_macro_f1_std,
        }

    def info(self) -> dict:
        return {
            "modelName": self.model_name,
            "features": self.features,
            "bestParams": self.best_params,
            "testAccuracy": self.test_accuracy,
            "testMacroF1": self.test_macro_f1,
            "cvMacroF1Mean": self.cv_macro_f1_mean,
            "cvMacroF1Std": self.cv_macro_f1_std,
            "featureImportances": self.feature_importances,
        }


@lru_cache(maxsize=1)
def get_classifier() -> RiskClassifier:
    return RiskClassifier()
