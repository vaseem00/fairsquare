"""Compare an asking price with registered sales in the same building."""
from __future__ import annotations

from dataclasses import dataclass, field
from statistics import median

from .config import settings

BAND_LABEL = {
    "above": "Above recent sales",
    "inline": "In line with recent sales",
    "below": "Below recent sales",
    "thin": "Not enough sales",
}


@dataclass
class Result:
    asking_psf: float
    count: int
    median_psf: float | None
    median_price: float | None
    diff: float | None          # 0.14 = 14% above the median; None when too few sales
    band: str
    sales: list = field(default_factory=list)

    @property
    def enough(self) -> bool:
        return self.diff is not None


def analyse(price_aed: float, size_sqft: float, sales, min_sales: int | None = None,
            band_pct: float | None = None) -> Result:
    """sales: iterable of rows with size_sqft and price_aed."""
    min_sales = settings.min_sales if min_sales is None else min_sales
    band = (settings.band_pct if band_pct is None else band_pct) / 100
    sales = [s for s in sales if s["size_sqft"] and s["price_aed"]]
    asking = price_aed / size_sqft
    psfs = [s["price_aed"] / s["size_sqft"] for s in sales]
    if len(psfs) < min_sales:
        return Result(asking, len(psfs), median(psfs) if psfs else None, None, None, "thin", sales)
    med = median(psfs)
    diff = asking / med - 1
    label = "above" if diff >= band else "below" if diff <= -band else "inline"
    return Result(asking, len(psfs), med, median(s["price_aed"] for s in sales), diff, label, sales)


def fmt_pct(diff: float) -> str:
    return f"{'+' if diff >= 0 else '−'}{abs(diff) * 100:.1f}%"


def fmt_aed(v: float) -> str:
    return f"AED {round(v):,}"


def beds_label(beds: int) -> str:
    return "studio" if beds == 0 else f"{beds}-bed"
