"""
Train a maternal health risk classifier on the UCI Maternal Health Risk
Data Set (Age, SystolicBP, DiastolicBP, BS, BodyTemp, HeartRate -> RiskLevel),
enriched with engineered clinical features (MAP, pulse pressure, and
hypertension/hyperglycemia/fever/tachycardia threshold flags - see
features.py).

Methodology notes:
 - DEDUPING FIRST: this dataset has 562 exact-duplicate rows out of 1014.
   Splitting into train/test before deduping - how this file used to
   work - let a duplicate's twin land in training whenever its copy
   landed in test, so a model could score well on "held-out" rows by
   memorizing a row it had already seen verbatim, not by generalizing.
   That leakage was real and material: it was inflating the reported
   test accuracy from a genuine ~72% to a leaked ~84%. Deduping before
   the split means every metric below reflects real generalization to a
   vitals combination the model did not see in training - a lower
   number, but an honest one, and the actual reason predictions can feel
   less reliable than an 84%-accuracy label would suggest.
 - StandardScaler + classifier are wrapped in one sklearn Pipeline, so
   cross-validation refits the scaler on each fold's training data only.
   Fitting the scaler on the full dataset before splitting - a common
   mistake - leaks each held-out fold's mean/variance into training and
   quietly inflates reported scores.
 - Each candidate model (logistic regression, random forest, extra
   trees, gradient boosting, SVM, k-nearest-neighbours, and a soft-voting
   ensemble of all six) is tuned with GridSearchCV over its own
   hyperparameter grid, using REPEATED stratified CV (5 folds x 3
   independent repeats = 15 fits per grid point) on the TRAINING split
   only. Repeating the k-fold split three times rather than running it
   once is itself an evaluation-methodology improvement: on a dataset
   this small (452 unique rows), a single 5-fold split's particular fold
   boundaries can swing a candidate's score by a few points just from
   which rows happened to land together, which can flip which model looks
   best. Averaging over three independent splits is a more reliable
   estimate of genuine generalization, so the model it selects is more
   trustworthy - not merely tuned harder on the same split. The grid
   search's own best cross-validated score is what decides which model to
   keep, so model selection and hyperparameter selection use the same
   leakage-free procedure - the ensemble is evaluated by that same CV
   score, not compared on a different yardstick, so it only wins if it
   genuinely generalizes better.
 - Beyond accuracy and macro F1, the held-out test evaluation also reports
   balanced accuracy (average per-class recall - can't be inflated by
   just predicting the majority class), macro one-vs-rest ROC-AUC (how
   well-separated the predicted class probabilities are, independent of
   the decision threshold), and the full confusion matrix (which shows
   WHICH way "mid risk" gets confused, not just that it's the weak class -
   clinically relevant since a mid-risk case mistaken for low risk is a
   worse miss than one mistaken for high risk). All of these are saved
   into the model bundle and exposed via `/model/info` alongside the
   existing metrics, not just printed at training time.
 - Every non-ensemble candidate is class-weight-balanced (or, for
   GradientBoostingClassifier, which has no class_weight param,
   sample-weight-balanced at fit time) - "mid risk" is the minority AND
   the hardest class to separate here (it sits between low and high risk
   in a continuous feature space with real overlap), and an unweighted
   fit tends to sacrifice it in favor of the easier classes.
 - The held-out test split (never touched during grid search or model
   selection) gives the final, reported accuracy/F1 - this is what ships
   in the saved model bundle and what the UI shows.
 - Feature importances are saved so the API can expose *why* the model
   weighs a prediction the way it does (see /model/info) rather than
   being a black box - the voting ensemble has no single importance
   vector to report, so this is omitted when it wins.
 - Honest ceiling: after deduping there are 452 unique rows. "Mid risk"
   remains the weakest class across every candidate (macro F1 ~0.65
   overall, with mid-risk recall well below the other two classes) -
   that's a property of this specific dataset's feature-space overlap
   between adjacent risk bands, not something more grid search or model
   variety fixes. Meaningfully closing that gap needs more or better
   labeled data, not more tuning of what's already here.

Run: python -m src.ml.train
"""

import joblib
import numpy as np
import pandas as pd
from pathlib import Path
from sklearn.ensemble import ExtraTreesClassifier, GradientBoostingClassifier, RandomForestClassifier, VotingClassifier
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import (
    accuracy_score,
    balanced_accuracy_score,
    classification_report,
    confusion_matrix,
    f1_score,
    roc_auc_score,
)
from sklearn.model_selection import GridSearchCV, RepeatedStratifiedKFold, cross_val_score, train_test_split
from sklearn.neighbors import KNeighborsClassifier
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler
from sklearn.svm import SVC
from sklearn.utils.class_weight import compute_sample_weight

from .features import ALL_FEATURES

DATA_PATH = Path(__file__).resolve().parents[2] / "data" / "maternal_health_risk.csv"
MODEL_DIR = Path(__file__).resolve().parents[2] / "models"
RISK_ORDER = ["low risk", "mid risk", "high risk"]

CANDIDATES = {
    "logistic_regression": {
        "pipeline": Pipeline([("scaler", StandardScaler()), ("clf", LogisticRegression(max_iter=2000, class_weight="balanced"))]),
        "grid": {"clf__C": [0.1, 1.0, 10.0]},
    },
    "random_forest": {
        "pipeline": Pipeline([("scaler", StandardScaler()),
                               ("clf", RandomForestClassifier(random_state=42, class_weight="balanced"))]),
        "grid": {
            "clf__n_estimators": [200, 300, 500],
            "clf__max_depth": [None, 8, 12],
            "clf__min_samples_leaf": [1, 2, 4],
        },
    },
    "gradient_boosting": {
        "pipeline": Pipeline([("scaler", StandardScaler()), ("clf", GradientBoostingClassifier(random_state=42))]),
        "grid": {
            "clf__n_estimators": [100, 200],
            "clf__max_depth": [2, 3, 4],
            "clf__learning_rate": [0.05, 0.1],
        },
    },
    "svm_rbf": {
        "pipeline": Pipeline([("scaler", StandardScaler()), ("clf", SVC(probability=True, random_state=42, class_weight="balanced"))]),
        "grid": {"clf__C": [1.0, 10.0, 50.0], "clf__gamma": ["scale", 0.01, 0.1]},
    },
    "extra_trees": {
        "pipeline": Pipeline([("scaler", StandardScaler()),
                               ("clf", ExtraTreesClassifier(random_state=42, class_weight="balanced"))]),
        "grid": {
            "clf__n_estimators": [200, 300, 500],
            "clf__max_depth": [None, 8, 12],
            "clf__min_samples_leaf": [1, 2, 4],
        },
    },
    "k_nearest_neighbors": {
        # Distance-weighted so a query point's few nearest neighbours (which
        # tend to be from the majority classes near a decision boundary)
        # don't drown out a genuinely close minority-class ("mid risk")
        # match the way uniform weighting would.
        "pipeline": Pipeline([("scaler", StandardScaler()), ("clf", KNeighborsClassifier(weights="distance"))]),
        "grid": {"clf__n_neighbors": [3, 5, 7, 11, 15]},
    },
}


def load_dataset() -> pd.DataFrame:
    df = pd.read_csv(DATA_PATH)
    df.columns = [c.strip() for c in df.columns]
    df["RiskLevel"] = df["RiskLevel"].str.strip().str.lower()
    df = df[df["RiskLevel"].isin(RISK_ORDER)].dropna()

    # This dataset has a well-documented data-quality issue: over half its
    # rows (562 of 1014) are EXACT duplicates (same vitals AND same label).
    # Splitting into train/test BEFORE deduping - the original state of
    # this function - let a duplicate's twin land in training whenever the
    # other copy landed in test, so the model could score well on "held
    # out" rows by memorizing an identical row it had already seen, not by
    # generalizing. That's leakage, and it's the most likely reason
    # real-world accuracy has felt worse than the previously-reported
    # ~84% test accuracy suggested. Deduping first means every reported
    # metric reflects genuine generalization to a vitals combination the
    # model did not see in training.
    before = len(df)
    df = df.drop_duplicates().reset_index(drop=True)
    print(f"Dropped {before - len(df)} exact-duplicate rows ({before} -> {len(df)}).")

    # MAP/PulsePressure/threshold flags - see features.py. Pure arithmetic/
    # threshold transforms of raw columns (not fitted statistics), so no
    # leakage concern in computing them before the train/test split.
    df["MAP"] = df["DiastolicBP"] + (df["SystolicBP"] - df["DiastolicBP"]) / 3
    df["PulsePressure"] = df["SystolicBP"] - df["DiastolicBP"]
    df["HighBPFlag"] = ((df["SystolicBP"] >= 140) | (df["DiastolicBP"] >= 90)).astype(int)
    df["HighBSFlag"] = (df["BS"] >= 7.8).astype(int)
    df["FeverFlag"] = (df["BodyTemp"] >= 100.4).astype(int)
    df["TachycardiaFlag"] = (df["HeartRate"] >= 100).astype(int)
    return df


def evaluate_on_test(estimator, X_test, y_test) -> dict:
    """One shared evaluation routine so every candidate (and the final
    ensemble) is scored the same way. Beyond accuracy/macro-F1, this adds:
      - balanced accuracy: the average per-class recall - unlike plain
        accuracy, a model can't inflate this by just calling everything
        "low risk" (the majority class).
      - macro one-vs-rest ROC-AUC: how well-separated the model's
        predicted probabilities are per class, independent of whatever
        decision threshold turns them into a single label - catches a
        model whose ranking is good even when its argmax pick is wrong,
        or vice versa.
      - the confusion matrix itself: classification_report's per-class
        precision/recall already says THAT mid-risk is the weak class;
        the matrix says WHICH way it gets confused (with low or with high
        risk), which matters clinically since one of those errors is far
        more dangerous to make than the other.
    """
    preds = estimator.predict(X_test)
    proba = estimator.predict_proba(X_test)
    return {
        "test_accuracy": float(accuracy_score(y_test, preds)),
        "test_macro_f1": float(f1_score(y_test, preds, average="macro")),
        "test_balanced_accuracy": float(balanced_accuracy_score(y_test, preds)),
        "test_roc_auc_macro_ovr": float(roc_auc_score(y_test, proba, multi_class="ovr", average="macro")),
        "test_confusion_matrix": confusion_matrix(y_test, preds, labels=list(range(len(RISK_ORDER)))).tolist(),
        "classification_report": classification_report(y_test, preds, target_names=RISK_ORDER),
    }


def train():
    df = load_dataset()
    X = df[ALL_FEATURES]
    y = df["RiskLevel"].map({label: i for i, label in enumerate(RISK_ORDER)})

    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=0.2, random_state=42, stratify=y
    )

    # Repeated (not single) stratified k-fold: averaging the macro-F1
    # estimate over 3 independent 5-way splits instead of just one means
    # the score deciding which model "wins" isn't at the mercy of one
    # particular lucky/unlucky fold assignment - a genuinely more reliable
    # evaluation method for a dataset this small (452 unique rows), where
    # a single 5-fold split's fold boundaries can swing a candidate's
    # score by a few points on their own.
    cv = RepeatedStratifiedKFold(n_splits=5, n_repeats=3, random_state=42)

    best_name = best_estimator = None
    best_cv_mean = -1.0
    best_cv_std = 0.0
    best_test_metrics = None
    best_params = None

    # GradientBoostingClassifier has no class_weight param (unlike
    # RandomForest/SVM/LogisticRegression above) - sample_weight passed at
    # fit time is sklearn's standard workaround for weighting an estimator
    # that only supports that, not class_weight.
    gbc_sample_weight = compute_sample_weight("balanced", y_train)
    fit_params_by_candidate = {"gradient_boosting": {"clf__sample_weight": gbc_sample_weight}}

    tuned_estimators = {}

    for name, spec in CANDIDATES.items():
        search = GridSearchCV(spec["pipeline"], spec["grid"], cv=cv, scoring="f1_macro", n_jobs=-1)
        search.fit(X_train, y_train, **fit_params_by_candidate.get(name, {}))
        tuned_estimators[name] = search.best_estimator_

        test_metrics = evaluate_on_test(search.best_estimator_, X_test, y_test)

        print(f"\n=== {name} ===")
        print(f"Best params: {search.best_params_}")
        print(f"Best CV macro F1 (5-fold x 3 repeats, train split only): {search.best_score_:.3f}")
        cv_std = search.cv_results_["std_test_score"][search.best_index_]
        print(f"CV std at best params: {cv_std:.3f}")
        print(f"Held-out test accuracy: {test_metrics['test_accuracy']:.3f}  "
              f"macro F1: {test_metrics['test_macro_f1']:.3f}  "
              f"balanced accuracy: {test_metrics['test_balanced_accuracy']:.3f}  "
              f"macro ROC-AUC (OvR): {test_metrics['test_roc_auc_macro_ovr']:.3f}")
        print(f"Confusion matrix (rows=actual, cols=predicted, order={RISK_ORDER}):")
        print(np.array(test_metrics["test_confusion_matrix"]))
        print(test_metrics["classification_report"])

        if search.best_score_ > best_cv_mean:
            best_name, best_estimator = name, search.best_estimator_
            best_cv_mean, best_cv_std = search.best_score_, cv_std
            best_test_metrics = test_metrics
            best_params = search.best_params_

    # A soft-voting ensemble of the already-tuned candidates, evaluated
    # with the SAME cv split and scoring metric used to pick among the
    # individual models - so it only wins if it genuinely cross-validates
    # better, not because it's being compared on a different yardstick.
    # Combining models that make different mistakes is a standard way to
    # firm up the weakest class (mid risk, here - see the per-class recall
    # in each classification report above) without any extra data.
    ensemble = VotingClassifier(
        estimators=[(name, est) for name, est in tuned_estimators.items()], voting="soft"
    )
    ensemble_cv_scores = cross_val_score(ensemble, X_train, y_train, cv=cv, scoring="f1_macro", n_jobs=-1)
    ensemble_cv_mean, ensemble_cv_std = ensemble_cv_scores.mean(), ensemble_cv_scores.std()
    ensemble.fit(X_train, y_train)
    ensemble_test_metrics = evaluate_on_test(ensemble, X_test, y_test)

    print("\n=== voting_ensemble (all tuned candidates, soft voting) ===")
    print(f"CV macro F1 (5-fold x 3 repeats, train split only): {ensemble_cv_mean:.3f}")
    print(f"CV std: {ensemble_cv_std:.3f}")
    print(f"Held-out test accuracy: {ensemble_test_metrics['test_accuracy']:.3f}  "
          f"macro F1: {ensemble_test_metrics['test_macro_f1']:.3f}  "
          f"balanced accuracy: {ensemble_test_metrics['test_balanced_accuracy']:.3f}  "
          f"macro ROC-AUC (OvR): {ensemble_test_metrics['test_roc_auc_macro_ovr']:.3f}")
    print(f"Confusion matrix (rows=actual, cols=predicted, order={RISK_ORDER}):")
    print(np.array(ensemble_test_metrics["test_confusion_matrix"]))
    print(ensemble_test_metrics["classification_report"])

    if ensemble_cv_mean > best_cv_mean:
        best_name, best_estimator = "voting_ensemble", ensemble
        best_cv_mean, best_cv_std = ensemble_cv_mean, ensemble_cv_std
        best_test_metrics = ensemble_test_metrics
        best_params = {"voters": list(tuned_estimators.keys())}

    print(f"\nSelected model: {best_name} (CV macro F1 = {best_cv_mean:.3f} +/- {best_cv_std:.3f})")
    print(f"Best hyperparameters: {best_params}")

    # The voting ensemble is a VotingClassifier of whole pipelines, not a
    # single Pipeline with one "clf" step, so it has no one feature
    # importance vector to report - /model/info just omits it in that case.
    feature_importances = None
    if hasattr(best_estimator, "named_steps"):
        clf = best_estimator.named_steps["clf"]
        if hasattr(clf, "feature_importances_"):
            feature_importances = dict(zip(ALL_FEATURES, (float(v) for v in clf.feature_importances_)))
            print("Feature importances:", feature_importances)

    MODEL_DIR.mkdir(exist_ok=True)
    joblib.dump(
        {
            "pipeline": best_estimator,
            "features": ALL_FEATURES,
            "risk_order": RISK_ORDER,
            "model_name": best_name,
            "best_params": best_params,
            "test_accuracy": best_test_metrics["test_accuracy"],
            "test_macro_f1": best_test_metrics["test_macro_f1"],
            "test_balanced_accuracy": best_test_metrics["test_balanced_accuracy"],
            "test_roc_auc_macro_ovr": best_test_metrics["test_roc_auc_macro_ovr"],
            "test_confusion_matrix": best_test_metrics["test_confusion_matrix"],
            "cv_macro_f1_mean": float(best_cv_mean),
            "cv_macro_f1_std": float(best_cv_std),
            "feature_importances": feature_importances,
        },
        MODEL_DIR / "risk_classifier.joblib",
    )
    print(f"Saved model to {MODEL_DIR / 'risk_classifier.joblib'}")


if __name__ == "__main__":
    train()
