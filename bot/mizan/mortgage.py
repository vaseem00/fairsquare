"""Monthly cost estimate. Shown as an estimate, never as an offer of credit."""
from __future__ import annotations

from dataclasses import dataclass


@dataclass
class Estimate:
    price: float
    down_pct: int
    loan: float
    monthly: float
    upfront: float
    rate_pct: float
    years: int


def estimate(price: float, down_pct: int = 20, rate_pct: float = 4.25, years: int = 25) -> Estimate:
    loan = price * (1 - down_pct / 100)
    r, n = rate_pct / 100 / 12, years * 12
    monthly = loan * r / (1 - (1 + r) ** -n) if r > 0 else loan / n
    down = price * down_pct / 100
    # Dubai buyer costs: 4% DLD transfer fee, 0.25% mortgage registration, 2% agency + 5% VAT
    upfront = down + price * 0.04 + loan * 0.0025 + price * 0.02 * 1.05
    return Estimate(price, down_pct, loan, monthly, upfront, rate_pct, years)
