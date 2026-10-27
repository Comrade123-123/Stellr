"""
Trains Exoplanet Lab's transit vetter: gradient-boosted trees that score how planet-like a
transit signal is, from numbers the lab measures (period, depth, duration) and, when known,
the star's size, temperature and surface gravity from the TESS Input Catalog.

Training data, from the NASA Exoplanet Archive: every signal already judged
  - Kepler's final cumulative KOI table: CONFIRMED vs FALSE POSITIVE;
  - TESS Objects of Interest: confirmed or known planet (CP, KP) vs false positive (FP).
The lab analyses TESS data, so the score that matters is on TESS signals the model never saw:
5-fold cross-validation over TESS stars (all of a star's signals in the same fold, so a
multi-planet system can't leak between training and test), each fold also trained on all of
Kepler. The same is reported for the earlier Kepler-only, star-blind model, for comparison.

Writes the model as JSON for the browser (lib/vetter.ts), with its metrics.

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
from sklearn.ensemble import GradientBoostingClassifier, HistGradientBoostingClassifier
from sklearn.metrics import precision_score, recall_score, roc_auc_score
from sklearn.model_selection import GroupKFold, StratifiedKFold

BASE = os.environ.get("EXO_BASE", "https://exoplanetarchive.ipac.caltech.edu")
EARTH_PER_SUN = 109.1

# Must match lib/vetter.ts, in order.
FEATURES = [
    "log10 period (d)",
    "log10 depth (ppm)",
    "log10 duration (h)",
    "log10 duration / (13 h · (P/1 yr)^(1/3))",
    "log10 implied planet radius (Earth radii)",
    "log10 duration / longest possible for the star",
    "star temperature (K)",
    "star surface gravity (log g)",
    "TESS (1) or Kepler (0)",
]


def tap(query):
    url = f"{BASE}/TAP/sync?query={urllib.parse.quote(query)}&format=json"
    req = urllib.request.Request(url, headers={"User-Agent": "Stellr vetter training"})
    with urllib.request.urlopen(req, timeout=300) as res:
        return json.load(res)


def num(v):
    try:
        f = float(v)
    except (TypeError, ValueError):
        return math.nan
    return f if math.isfinite(f) else math.nan


def features(period, duration_h, depth_ppm, star_radius, star_teff, star_logg, tess):
    """The model's inputs, NaN where unknown; None when the signal itself is unusable."""
    p, d, dep = num(period), num(duration_h), num(depth_ppm)
    if not (p > 0 and d > 0 and dep > 0):
        return None
    r = num(star_radius)
    r = r if r > 0 else math.nan
    planet = math.sqrt(dep * 1e-6) * r * EARTH_PER_SUN
    longest = 13 * (p / 365.25) ** (1 / 3) * r ** (2 / 3)  # star mass taken ≈ its radius
    return [
        math.log10(p),
        math.log10(dep),
        math.log10(d),
        math.log10(d / (13 * (p / 365.25) ** (1 / 3))),
        math.log10(planet) if planet > 0 else math.nan,
        math.log10(d / longest) if longest > 0 else math.nan,
        num(star_teff),
        num(star_logg),
        float(tess),
    ]


def build(rows, cols, label, tess, group=None):
    X, y, g = [], [], []
    for r in rows:
        f = features(*(r.get(c) for c in cols), tess)
        if f is not None:
            X.append(f)
            y.append(label(r))
            g.append(str(r.get(group)) if group else "")
    return np.array(X, dtype=float), np.array(y), np.array(g)


def metrics(y, p):
    return {
        "auc": round(float(roc_auc_score(y, p)), 3),
        "precision": round(float(precision_score(y, p >= 0.5, zero_division=0)), 3),
        "recall": round(float(recall_score(y, p >= 0.5)), 3),
        "n": int(len(y)),
        "planets": int(y.sum()),
    }


def new_model():
    return HistGradientBoostingClassifier(
        max_iter=220, learning_rate=0.06, max_leaf_nodes=12, min_samples_leaf=30, l2_regularization=1.0, early_stopping=False, random_state=0
    )


def main(out):
    kepler = tap(
        "select koi_disposition, koi_period, koi_duration, koi_depth, koi_srad, koi_steff, koi_slogg from cumulative "
        "where koi_disposition in ('CONFIRMED', 'FALSE POSITIVE')"
    )
    Xk, yk, _ = build(
        kepler,
        ("koi_period", "koi_duration", "koi_depth", "koi_srad", "koi_steff", "koi_slogg"),
        lambda r: int(r["koi_disposition"] == "CONFIRMED"),
        0,
    )
    toi = tap(
        "select tid, tfopwg_disp, pl_orbper, pl_trandurh, pl_trandep, st_rad, st_teff, st_logg from toi "
        "where tfopwg_disp in ('CP', 'KP', 'FP')"
    )
    Xt, yt, gt = build(
        toi,
        ("pl_orbper", "pl_trandurh", "pl_trandep", "st_rad", "st_teff", "st_logg"),
        lambda r: int(r["tfopwg_disp"] in ("CP", "KP")),
        1,
        group="tid",
    )
    print(f"Kepler: {len(yk)} signals ({int(yk.sum())} planets); TESS: {len(yt)} signals ({int(yt.sum())} planets) on {len(set(gt))} stars")

    # TESS, cross-validated by star: each fold trains on all of Kepler plus the other TESS stars.
    p_tess = np.zeros(len(yt))
    p_tess_old = np.zeros(len(yt))
    for train, test in GroupKFold(n_splits=5).split(Xt, yt, gt):
        m = new_model().fit(np.vstack([Xk, Xt[train]]), np.concatenate([yk, yt[train]]))
        p_tess[test] = m.predict_proba(Xt[test])[:, 1]
    # The earlier model: Kepler only, the four star-blind features, plain gradient boosting.
    old = GradientBoostingClassifier(n_estimators=120, max_depth=3, learning_rate=0.1, subsample=0.8, random_state=0)
    blind = ~np.isnan(Xk[:, :4]).any(axis=1)
    old.fit(Xk[blind][:, :4], yk[blind])
    p_tess_old = old.predict_proba(Xt[:, :4])[:, 1]

    # Kepler, cross-validated, each fold also trained on all of TESS.
    p_kep = np.zeros(len(yk))
    for train, test in StratifiedKFold(n_splits=5, shuffle=True, random_state=0).split(Xk, yk):
        m = new_model().fit(np.vstack([Xk[train], Xt]), np.concatenate([yk[train], yt]))
        p_kep[test] = m.predict_proba(Xk[test])[:, 1]

    results = {"tess": metrics(yt, p_tess), "kepler": metrics(yk, p_kep), "tess_previous": metrics(yt, p_tess_old)}
    print(json.dumps(results, indent=1))

    final = new_model().fit(np.vstack([Xk, Xt]), np.concatenate([yk, yt]))

    # Export: raw score = baseline + Σ leaf values (shrinkage already in them); probability = 1 / (1 + e^−raw).
    baseline = float(np.ravel(final._baseline_prediction)[0])
    trees = []
    for (pred,) in final._predictors:
        nd = pred.nodes
        trees.append(
            {
                "f": nd["feature_idx"].tolist(),
                # Full precision: a training value can sit within a rounding error of a threshold.
                "t": [float(v) for v in nd["num_threshold"]],
                "m": [int(v) for v in nd["missing_go_to_left"]],
                "l": nd["left"].tolist(),
                "r": nd["right"].tolist(),
                "v": [round(float(v), 6) for v in nd["value"]],
                "leaf": [int(v) for v in nd["is_leaf"]],
            }
        )

    def evaluate(x):
        raw = baseline
        for tr in trees:
            n = 0
            while not tr["leaf"][n]:
                v = x[tr["f"][n]]
                if math.isnan(v):
                    n = tr["l"][n] if tr["m"][n] else tr["r"][n]
                else:
                    n = tr["l"][n] if v <= tr["t"][n] else tr["r"][n]
            raw += tr["v"][n]
        return raw

    # The exported trees must reproduce scikit-learn's own scores, missing values included.
    sample = np.vstack([Xk[:150], Xt[:150]])
    check = final.decision_function(sample)
    worst = max(abs(evaluate(sample[i]) - check[i]) for i in range(len(check)))
    assert worst < 1e-3, f"export mismatch {worst}"

    model_json = {
        "version": 2,
        "kind": "histogram gradient-boosted trees",
        "features": FEATURES,
        "init": round(baseline, 6),
        "trees": trees,
        "metrics": results,
        "counts": {"kepler": int(len(yk)), "tess": int(len(yt))},
        "trained": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%d"),
        "sklearn": sklearn.__version__,
        "source": "NASA Exoplanet Archive: Kepler cumulative KOI table and TESS TOI table",
    }
    os.makedirs(os.path.dirname(out) or ".", exist_ok=True)
    with open(out, "w") as fh:
        json.dump(model_json, fh, separators=(",", ":"))
    print(f"wrote {out}: {len(trees)} trees, {os.path.getsize(out) // 1024} KB")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "public/models/vetter.json")
