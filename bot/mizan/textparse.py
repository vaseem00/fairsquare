"""Parse details a user types by hand, e.g. "2 bed, 1284 sqft, 2.45m"."""
from __future__ import annotations

import re


def parse_fields(text: str) -> dict:
    t = text.lower().replace(",", "")
    out: dict = {}

    if re.search(r"\bstudio\b", t):
        out["bedrooms"] = 0
    elif m := re.search(r"(\d+)\s*(?:br|bed|beds|bedroom|bedrooms|bhk)\b", t):
        out["bedrooms"] = int(m.group(1))

    if m := re.search(r"(\d+(?:\.\d+)?)\s*(?:sq\.?\s*ft|sqft|sft|square feet|ft2)", t):
        out["size_sqft"] = float(m.group(1))
    elif m := re.search(r"(\d+(?:\.\d+)?)\s*(?:sq\.?\s*m|sqm|m2)\b", t):
        out["size_sqft"] = round(float(m.group(1)) * 10.7639, 1)

    if m := re.search(r"(?:aed|dhs?|د\.إ)?\s*(\d+(?:\.\d+)?)\s*(m|mn|million|k)\b", t):
        mult = 1_000 if m.group(2) == "k" else 1_000_000
        out["price_aed"] = float(m.group(1)) * mult
    elif m := re.search(r"(?:aed|dhs?)\s*(\d{5,9})", t):
        out["price_aed"] = float(m.group(1))
    else:
        # A bare large number is most likely the price
        nums = [float(n) for n in re.findall(r"\b(\d{6,9})\b", t)]
        if nums:
            out["price_aed"] = max(nums)
    return out
