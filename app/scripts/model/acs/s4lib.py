"""Helpers: load the backtest results, apply the range and the rule (one place), print helpers."""
import os, sys, json, math
import numpy as np
import lib as L, bt, cal, acs as A
import evalx_const as EC

TEST = (2, 3, 4, 5); CN = bt.CUTS6
REAS = ["shown", "no_comparables", "bedrooms_not_validated", "no_close_comparables", "too_few_comparables", "size_too_far", "no_calibration", "range_too_wide"]


def apply_rule(D, rule, lo, hi):
    """Reason code per row (0 = shown). The same order as acs.decide."""
    c = D["main_centre"]; N = len(c)
    hw = (np.exp(hi) - np.exp(lo)) / (2 * np.exp(c))
    reason = np.zeros(N, np.int64); lsr = np.nan_to_num(D["main_lsr_w"], nan=0.0)
    tr_ = D["size"] / D["typ"]; typbad = np.isfinite(tr_) & ((tr_ < rule["typLo"]) | (tr_ > rule["typHi"]))
    refc = np.isin(D["cls"], rule["refuseClasses"])
    for bs, cl in rule.get("refuseBasisClasses", []): refc |= (D["basis"] == bs) & (D["cls"] == cl)
    few = (D["main_n"] < rule["minComps"]) | (D["main_W"] < rule["minWeight"] - A.EPS)
    if rule.get("minWeightKnown", 0) > 0: few |= (D["scen"] != 2) & (D["main_W"] < rule["minWeightKnown"] - A.EPS)
    if rule.get("minOwn", 0) > 0: few |= (D["scen"] != 2) & (D["main_n1"] < rule["minOwn"])
    for code, m in ((7, hw > rule["maxHalfWidth"]), (6, ~np.isfinite(lo)), (5, (lsr > rule["maxLsr"]) | typbad), (4, few), (3, refc), (2, D["bed"] > rule["maxBedrooms"]), (1, ~D["ok"])):
        reason[m] = code
    return reason, hw


def evaluate(D, rule=None, rc=None, guard=True, test=TEST):
    rule = rule or EC.RULE; rc = rc or EC.RC
    lo, hi, Qs, g, s = cal.forward_ranges(D, rc, guard, test=test)
    reason, hw = apply_rule(D, rule, lo, hi)  # optional rule keys allowed (exploration); equal to cal.apply_rule for the final rule (asserted in s4/final_eval.py)
    st = rule["rounding"]
    return dict(lo=lo, hi=hi, hw=hw, cov=(D["truth"] >= lo) & (D["truth"] <= hi), reason=reason, shown=reason == 0, g=g, s=s, Qs=Qs,
                rlo=np.round(np.exp(lo) / st) * st, rhi=np.round(np.exp(hi) / st) * st, gn=np.array([cal.gname(int(x)) for x in g]))


def f100(v): return 100 * (math.exp(v) - 1)


def es(x, short=False):
    x = x[np.isfinite(x)]
    if len(x) < 20: return f"n={len(x)}"
    a = np.abs(x)
    if short: return f"{f100(np.median(a)):5.2f} / {f100(np.quantile(a, .8)):5.2f}"
    return f"n={len(x):6d} {f100(np.median(a)):5.2f} / {f100(np.quantile(a, .8)):5.2f} / {f100(np.quantile(a, .9)):5.2f} bias {f100(np.median(x)):+5.2f}"


def esn(x):
    """[n, typical, p80, p90, bias] as numbers (None when under 20)."""
    x = x[np.isfinite(x)]
    if len(x) < 20: return [int(len(x)), None, None, None, None]
    a = np.abs(x); r = lambda v: round(f100(v), 2)
    return [int(len(x)), r(np.median(a)), r(np.quantile(a, .8)), r(np.quantile(a, .9)), r(np.median(x))]


def wmean(v, w): return 100 * float((v * w).sum() / max(w.sum(), 1e-12))
