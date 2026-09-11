"""
Hemoglobin-based anemia grading using India's Anemia Mukt Bharat / MoHFW
cutoffs for pregnant women. Anemia in pregnancy is one of India's most
prevalent maternal health problems (NFHS-5 found roughly half of pregnant
women in India anemic), which is why it gets its own dedicated,
deterministic scorer rather than relying only on symptom-narrative
phrase-matching:

  >= 11 g/dL      Normal
  10 - 10.9 g/dL  Mild anemia
  7 - 9.9 g/dL    Moderate anemia
  < 7 g/dL        Severe anemia (transfusion-risk range)

Hemoglobin is NOT one of the six vitals the trained ML classifier was fit
on (the UCI training dataset never recorded it - see src/ml/train.py), so
it is intentionally scored here as a separate, optional deterministic
input and blended into the 'anemia' category the same way the text-based
symptom signal is (worst-signal-wins) - not by retraining the classifier
on a feature it has no labeled outcome data for.
"""


def score(hemoglobin_g_dl: float) -> dict:
    if hemoglobin_g_dl < 7:
        grade, level = "Severe anemia", 0.9
    elif hemoglobin_g_dl < 10:
        grade, level = "Moderate anemia", 0.7
    elif hemoglobin_g_dl < 11:
        grade, level = "Mild anemia", 0.4
    else:
        grade, level = "Normal", 0.0

    return {
        "hemoglobin": hemoglobin_g_dl,
        "grade": grade,
        "score": level,
        "methodology": (
            "India Anemia Mukt Bharat / MoHFW pregnancy anemia grading "
            "(Normal >=11, Mild 10-10.9, Moderate 7-9.9, Severe <7 g/dL)."
        ),
    }
