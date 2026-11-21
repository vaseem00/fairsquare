"""Helpers: forward ranges with a guard variant; the nominal level per basis (ready flats at 85%, off-plan at 80%)."""
import sys, os, math
import numpy as np
from s4lib import *

def make_q(D, g, s, calib, rc, sym=(), nom=None, guard=True):
    """cal.fit_q, then: nom = {basis: nominal} refits that basis at another nominal level; sym = bases whose two sides both take
    the larger multiplier (the direction of the next months is not known)."""
    Q = cal.fit_q(D, g, s, calib, rc, guard)
    for bs, nm in (nom or {}).items():
        Q2 = cal.fit_q(D, g, s, calib, rc, guard, nom=nm)
        for k, v in Q2.items():
            if k.startswith(f"{bs}|"): Q[k] = v
    for k in list(Q):
        if int(k.split("|")[0]) in sym: m = max(Q[k]); Q[k] = [m, m]
    return Q

def fwd(D, rc, test=TEST, **kw):
    g, s = cal.feats(D, rc); lo = np.full(len(g), np.nan); hi = np.full(len(g), np.nan); Qs = {}
    base = D["ok"] & (D["bed"] <= 3)
    for ci in test:
        calib = base & (D["cut"] < ci) & (D["day"] <= D["T"][ci]); Q = make_q(D, g, s, calib, rc, **kw); Qs[ci] = Q
        rows = np.where(D["ok"] & (D["cut"] == ci))[0]; l, h = cal.apply_q(D, g, s, Q, rows); lo[rows] = l; hi[rows] = h
    return lo, hi, Qs, g, s

def evaluate5(D, rule=None, rc=None, test=TEST, **kw):
    rule = rule or EC.RULE; rc = rc or EC.RC
    lo, hi, Qs, g, s = fwd(D, rc, test, **kw); reason, hw = apply_rule(D, rule, lo, hi); st = rule["rounding"]
    return dict(lo=lo, hi=hi, hw=hw, cov=(D["truth"] >= lo) & (D["truth"] <= hi), reason=reason, shown=reason == 0, g=g, s=s, Qs=Qs,
                rlo=np.round(np.exp(lo) / st) * st, rhi=np.round(np.exp(hi) / st) * st, gn=np.array([cal.gname(int(x)) for x in g]))
