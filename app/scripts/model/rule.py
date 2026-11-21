"""The refusal rule of the similar-buildings comparison (REAL_DATA.md section 15.3), as the backtest
applies it to one replicate. It mirrors `compareSimilar` in src/lib/domain/similar.ts; keep the two in step.

r: the ingredients of one comparison (vbt.ingredients): own, o1, o2 (ln median, count) and ob.
p: the result of vbt.apply(r, C), which already applies: more than maxBedrooms, a class in
   neverShownClasses, a half-width over maxHalfWidth.
"""
import math

def show2(r, p, C):
    """(shown, reason)."""
    if not p: return False, "no_evidence"
    if r["bed"] > C["maxBedrooms"]: return False, "bedrooms_not_validated"
    if p["cls"] in C["neverShownClasses"]: return False, "no_building_evidence"
    # Only the 1 to 4 sales of the 12 months, nothing else from the building and no other building.
    if C.get("requireEvidenceBeyondOwnSales") and r["own"] and not r["o1"] and not r["o2"] and not r["ob"] and p["level"] is None:
        return False, "own_sales_only"
    if not p["shown"]: return False, "range_too_wide"
    # The building's own medians (12 months, 12 to 24 and 24 to 36 months back) too far apart.
    pieces = [x[0] for x in (r["own"], r["o1"], r["o2"]) if x]
    ratio = C.get("maxOwnMedianRatio")
    if ratio is not None and len(pieces) >= 2 and max(pieces) - min(pieces) > math.log(ratio): return False, "evidence_disagrees"
    # The median of the building's own sales of the 12 months outside the rounded range.
    if C.get("ownMedianInsideRange") and r["own"]:
        step = C["displayRounding"]
        rlo = round(math.exp(p["low"]) / step) * step; rhi = round(math.exp(p["high"]) / step) * step
        o = math.exp(r["own"][0])
        if o < rlo or o > rhi: return False, "evidence_disagrees"
    return True, None
