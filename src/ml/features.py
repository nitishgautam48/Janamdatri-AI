"""
Feature engineering shared between training and inference so both compute
identical derived clinical features from raw vitals - a mismatch here
would silently make predictions wrong without ever raising an error.
"""

BASE_FEATURES = ["Age", "SystolicBP", "DiastolicBP", "BS", "BodyTemp", "HeartRate"]
ALL_FEATURES = BASE_FEATURES + ["MAP"]


def add_engineered_features(row: dict) -> dict:
    """row must already contain BASE_FEATURES keys. Adds Mean Arterial
    Pressure (MAP = DBP + 1/3*(SBP-DBP)) - a single number that weighs
    diastolic pressure more heavily than systolic, and is a better
    single predictor of pre-eclampsia risk in pregnancy than either raw
    BP reading alone."""
    enriched = dict(row)
    enriched["MAP"] = row["DiastolicBP"] + (row["SystolicBP"] - row["DiastolicBP"]) / 3
    return enriched
