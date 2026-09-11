"""
Feature engineering shared between training and inference so both compute
identical derived clinical features from raw vitals - a mismatch here
would silently make predictions wrong without ever raising an error.
"""

BASE_FEATURES = ["Age", "SystolicBP", "DiastolicBP", "BS", "BodyTemp", "HeartRate"]
# Binary clinical-threshold flags, on top of the continuous values, encode
# the same cutoffs a health worker's own mental checklist would use
# (hypertension, hyperglycemia, fever, tachycardia). On a dataset this
# small (452 rows after deduping - see train.py), a tree model doesn't
# always land on the clinically "right" split point from raw values alone
# with so little data to find it in; handing it the threshold pre-computed
# is a standard way to bake in domain knowledge a bigger dataset would
# otherwise be needed to learn from scratch.
ENGINEERED_FEATURES = ["MAP", "PulsePressure", "HighBPFlag", "HighBSFlag", "FeverFlag", "TachycardiaFlag"]
ALL_FEATURES = BASE_FEATURES + ENGINEERED_FEATURES


def add_engineered_features(row: dict) -> dict:
    """row must already contain BASE_FEATURES keys. Adds:
    - Mean Arterial Pressure (MAP = DBP + 1/3*(SBP-DBP)) - weighs diastolic
      pressure more heavily than systolic, and is a better single predictor
      of pre-eclampsia risk in pregnancy than either raw BP reading alone.
    - Pulse Pressure (SBP-DBP) - a widened pulse pressure is an independent
      cardiovascular-risk signal MAP alone can miss, since two readings
      with the same MAP can have very different systolic/diastolic gaps.
    - Threshold flags for hypertension (>=140/90), hyperglycemia (BS>=7.8
      mmol/L, the standard gestational-diabetes-range cutoff), fever
      (>=100.4°F/38°C), and tachycardia (heart rate >=100 bpm)."""
    enriched = dict(row)
    enriched["MAP"] = row["DiastolicBP"] + (row["SystolicBP"] - row["DiastolicBP"]) / 3
    enriched["PulsePressure"] = row["SystolicBP"] - row["DiastolicBP"]
    enriched["HighBPFlag"] = int(row["SystolicBP"] >= 140 or row["DiastolicBP"] >= 90)
    enriched["HighBSFlag"] = int(row["BS"] >= 7.8)
    enriched["FeverFlag"] = int(row["BodyTemp"] >= 100.4)
    enriched["TachycardiaFlag"] = int(row["HeartRate"] >= 100)
    return enriched
