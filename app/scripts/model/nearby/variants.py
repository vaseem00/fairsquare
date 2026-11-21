"""Named variant sets for run.py. A variant: P (overrides of nlib.P0), hide ('building' | 'project'),
mode ('both' | 'comm' | 'area'), vint ('none' | 'new' | 'known')."""
BIG = 1e9
PLAIN = dict(win=365, age_half=BIG, size_half=BIG, cap=BIG, r_area=1.0, time=0, size=0)

SETS = {}
# Step 1: what each ingredient is worth (tuning cutoffs).
SETS["s1"] = {
    "area_plain": dict(P=PLAIN, mode="area"),
    "comm_plain": dict(P=PLAIN, mode="comm"),
    "both_plain": dict(P=dict(PLAIN, r_area=0.3)),
    "plain_time": dict(P=dict(PLAIN, r_area=0.3, time=1)),
    "plain_time_size": dict(P=dict(PLAIN, r_area=0.3, time=1, size=1)),
    "plus_cap": dict(P=dict(PLAIN, r_area=0.3, time=1, size=1, cap=1.0)),
    "plus_kern": dict(P=dict(PLAIN, r_area=0.3, time=1, size=1, cap=1.0, size_half=0.25, age_half=6.0, win=730)),
    "base": dict(),
    "base_new": dict(vint="new", P=dict(vint_half=1.0)),
    "base_known": dict(vint="known", P=dict(vint_half=1.0)),
    "base_hp": dict(hide="project"),
    "base_hp_new": dict(hide="project", vint="new", P=dict(vint_half=1.0)),
}
# Step 2: one-at-a-time changes around the base (tuning cutoffs only).
s2 = {"base": dict()}
for k, vals in (("age_half", (3.0, 12.0, 24.0)), ("size_half", (0.15, 0.4)), ("cap", (0.3, 3.0, 10.0, BIG)), ("r_area", (0.0, 0.1, 1.0)), ("win", (365,)), ("r_proj", (3.0, 10.0))):
    for v in vals: s2[f"{k}={v:g}"] = dict(P={k: v})
for vh in (0.25, 0.5, 1.0, 2.0, 4.0):
    s2[f"new_vh={vh:g}"] = dict(vint="new", P=dict(vint_half=vh))
    s2[f"known_vh={vh:g}"] = dict(vint="known", P=dict(vint_half=vh))
SETS["s2"] = s2
# Step 3: community first with the area as fallback; the vintage adjustment; the cap. c_ = community rows only, b_ = both.
P1 = dict(cap=10.0)
s3 = {}
for pre, kw in (("c", dict(mode="comm")), ("b", dict(P=dict(r_area=1.0)))):
    def mk(extraP=None, **more):
        P = dict(P1); P.update(kw.get("P", {})); P.update(extraP or {})
        d = dict(kw); d["P"] = P; d.update(more); return d
    s3[f"{pre}_none"] = mk()
    s3[f"{pre}_blind"] = mk(vadj="blind")
    s3[f"{pre}_known"] = mk(vadj="known")
    s3[f"{pre}_known_k2"] = mk(dict(vint_half=2.0), vadj="known", vint="known")
    s3[f"{pre}_known_k1"] = mk(dict(vint_half=1.0), vadj="known", vint="known")
    s3[f"{pre}_blind_k1"] = mk(dict(vint_half=1.0), vadj="blind", vint="new")
    s3[f"{pre}_known_cap1"] = mk(dict(cap=1.0), vadj="known")
    s3[f"{pre}_known_capinf"] = mk(dict(cap=BIG), vadj="known")
    s3[f"{pre}_blind_cap1"] = mk(dict(cap=1.0), vadj="blind")
    s3[f"{pre}_blind_capinf"] = mk(dict(cap=BIG), vadj="blind")
SETS["s3"] = s3
# The chosen method (all four cutoffs). in = the building is in the data (its age is known); out = it is not.
# _c community rows only, _b community and DLD area (area-only rows at r_area), _a DLD area only (community unknown).
PF = dict(cap=1.0, age_half=6.0, size_half=0.25, win=730, r_area=0.3)
f = {}
for hide, hs in (("building", ""), ("project", "_hp")):
    for mode, ms in (("comm", "_c"), ("both", "_b"), ("area", "_a")):
        f[f"in{ms}{hs}"] = dict(P=dict(PF, vint_half=1.0), mode=mode, hide=hide, vadj="known", vint="known")
        f[f"out{ms}{hs}"] = dict(P=dict(PF), mode=mode, hide=hide, vadj="offnew")
SETS["f"] = f
