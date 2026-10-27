"""
Trains Exoplanet Lab's transit vetter: a small gradient-boosted tree model that scores how
planet-like a transit signal is from four numbers the lab measures itself (period, depth,
duration, and duration against what a planet's orbit allows).

Training data: the Kepler mission's final cumulative KOI table, signals already judged
CONFIRMED (planet) or FALSE POSITIVE, from the NASA Exoplanet Archive. As a harder test it is
also scored on TESS Objects of Interest the TESS follow-up team has decided (CP/KP vs FP):
a different telescope, so this shows how well it carries over.

Writes the model as JSON for the browser to evaluate (lib/vetter.ts), with its metrics.

    python scripts/train_vetter.py public/models/vetter.json

EXO_BASE overrides the archive's address, for tests.
"""

import datetime
import json
import math
import os
import sys
import urllib.parse
import urllib.request

import numpy as np
import sklearn
from sklearn.ensemble import GradientBoostingClassifier
from sklearn.metrics import precision_score, recall_score, roc_auc_score
from sklearn.model_selection import StratifiedKFold, cross_val_predict

BASE = os.environ.get("EXO_BASE", "https://exoplanetarchive.ipac.caltech.edu")
FEATURES = ["log10 period (d)", "log10 depth (ppm)", "log10 duration (h)", "log10 duration / (13 h · (P/1 yr)^(1/3))"]


def tap(query):
    url = f"{BASE}/TAP/sync?query={urllib.parse.quote(query)}&format=json"
    req = urllib.request.Request(url, headers={"User-Agent": "Stellr vetter training"})
    with urllib.request.urlopen(req, timeout=300) as res:
        return json.load(res)


def features(period, duration_h, depth_ppm):
    """The model's inputs; None when a value is missing or unphysical. Must match lib/vetter.ts."""
    try:
        p, d, dep = float(period), float(duration_h), float(depth_ppm)
    except (TypeError, ValueError):
        return None
    if not (p > 0 and d > 0 and dep > 0) or any(math.isnan(v) for v in (p, d, dep)):
        return None
    return [math.log10(p), math.log10(dep), math.log10(d), math.log10(d / (13 * (p / 365.25) ** (1 / 3)))]


def table(rows, cols, label):
    xs, ys = [], []
    for r in rows:
        f = features(r[cols[0]], r[cols[1]], r[cols[2]])
        if f is not None:
            xs.append(f)
            ys.append(label(r))
    return np.array(xs), np.array(ys)


def main(out):
    kepler = tap(
        "select koi_disposition, koi_period, koi_duration, koi_depth from cumulative "
        "where koi_disposition in ('CONFIRMED', 'FALSE POSITIVE')"
    )
    X, y = table(kepler, ("koi_period", "koi_duration", "koi_depth"), lambda r: int(r["koi_disposition"] == "CONFIRMED"))
    print(f"Kepler: {len(y)} signals, {int(y.sum())} planets, {int(len(y) - y.sum())} false positives")

    def model():
        return GradientBoostingClassifier(n_estimators=120, max_depth=3, learning_rate=0.1, subsample=0.8, random_state=0)

    # Honest numbers: each signal scored by a model that never saw it.
    folds = StratifiedKFold(n_splits=5, shuffle=True, random_state=0)
    p_cv = cross_val_predict(model(), X, y, cv=folds, method="predict_proba")[:, 1]
    kepler_metrics = {
        "auc": round(float(roc_auc_score(y, p_cv)), 3),
        "precision": round(float(precision_score(y, p_cv >= 0.5)), 3),
        "recall": round(float(recall_score(y, p_cv >= 0.5)), 3),
        "n": int(len(y)),
        "planets": int(y.sum()),
    }
    print("Kepler 5-fold:", kepler_metrics)

    m = model().fit(X, y)

    tess_metrics = None
    try:
        toi = tap(
            "select tfopwg_disp, pl_orbper, pl_trandurh, pl_trandep from toi "
            "where tfopwg_disp in ('CP', 'KP', 'FP')"
        )
        Xt, yt = table(toi, ("pl_orbper", "pl_trandurh", "pl_trandep"), lambda r: int(r["tfopwg_disp"] in ("CP", "KP")))
        if len(set(yt)) == 2:
            pt = m.predict_proba(Xt)[:, 1]
            tess_metrics = {
                "auc": round(float(roc_auc_score(yt, pt)), 3),
                "precision": round(float(precision_score(yt, pt >= 0.5)), 3),
                "recall": round(float(recall_score(yt, pt >= 0.5)), 3),
                "n": int(len(yt)),
                "planets": int(yt.sum()),
            }
            print("TESS (unseen telescope):", tess_metrics)
    except Exception as e:  # the TESS test is a bonus; the model stands without it
        print("TESS test skipped:", e)

    # Export: raw score = init + rate × Σ leaf values; probability = 1 / (1 + e^−raw).
    init = float(m._raw_predict_init(X[:1])[0, 0])
    trees = []
    for est in m.estimators_[:, 0]:
        t = est.tree_
        trees.append(
            {
                "f": t.feature.tolist(),
                "t": [round(float(v), 6) for v in t.threshold],
                "l": t.children_left.tolist(),
                "r": t.children_right.tolist(),
                "v": [round(float(v), 6) for v in t.value[:, 0, 0]],
            }
        )

    def evaluate(x):
        raw = init
        for tr in trees:
            n = 0
            while tr["l"][n] != -1:
                n = tr["l"][n] if x[tr["f"][n]] <= tr["t"][n] else tr["r"][n]
            raw += m.learning_rate * tr["v"][n]
        return raw

    # The exported trees must reproduce scikit-learn's own scores.
    check = m.decision_function(X[:200])
    worst = max(abs(evaluate(X[i]) - check[i]) for i in range(len(check)))
    assert worst < 1e-3, f"export mismatch {worst}"

    model_json = {
        "kind": "gradient-boosted trees",
        "features": FEATURES,
        "init": round(init, 6),
        "rate": m.learning_rate,
        "trees": trees,
        "metrics": {"kepler": kepler_metrics, "tess": tess_metrics},
        "trained": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%d"),
        "sklearn": sklearn.__version__,
        "source": "NASA Exoplanet Archive: Kepler cumulative KOI table (training), TESS TOI table (test)",
    }
    os.makedirs(os.path.dirname(out) or ".", exist_ok=True)
    with open(out, "w") as fh:
        json.dump(model_json, fh, separators=(",", ":"))
    print(f"wrote {out}: {len(trees)} trees, {os.path.getsize(out) // 1024} KB")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "public/models/vetter.json")
