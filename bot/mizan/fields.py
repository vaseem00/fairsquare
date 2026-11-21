"""The facts read from a listing. Kept apart from extract.py so it loads without the Anthropic SDK."""
from __future__ import annotations

from typing import Literal, Optional

from pydantic import BaseModel


class ListingFields(BaseModel):
    is_listing: bool
    listing_type: Literal["sale", "rent", "unknown"]
    building_text: Optional[str] = None
    area_text: Optional[str] = None
    bedrooms: Optional[int] = None
    size_sqft: Optional[float] = None
    price_aed: Optional[float] = None

    def missing(self) -> list[str]:
        return [f for f in ("bedrooms", "size_sqft", "price_aed") if getattr(self, f) is None]
