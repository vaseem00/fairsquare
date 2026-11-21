"""Read a listing screenshot (or pasted listing text) with Claude and return four fields."""
from __future__ import annotations

import base64
import io
import json
import logging
import anthropic
from PIL import Image
from pydantic import ValidationError

from .config import settings
from .fields import ListingFields

log = logging.getLogger(__name__)


class ExtractionError(Exception):
    """Raised when Claude could not read the listing. The message is safe to show the user."""


_nullable = lambda t: {"anyOf": [{"type": t}, {"type": "null"}]}  # noqa: E731

SCHEMA = {
    "type": "object",
    "properties": {
        "is_listing": {"type": "boolean"},
        "listing_type": {"type": "string", "enum": ["sale", "rent", "unknown"]},
        "building_text": _nullable("string"),
        "area_text": _nullable("string"),
        "bedrooms": _nullable("integer"),
        "size_sqft": _nullable("number"),
        "price_aed": _nullable("number"),
    },
    "required": ["is_listing", "listing_type", "building_text", "area_text", "bedrooms", "size_sqft", "price_aed"],
    "additionalProperties": False,
}

SYSTEM = """You read Dubai property listings and return their key facts as JSON.

The input is a screenshot or pasted text from a property portal, an agent's WhatsApp message, or a social media post.

Rules:
- is_listing: true only if the input advertises a specific property for sale or rent.
- listing_type: "sale" for a sale price, "rent" for a yearly or monthly rent, otherwise "unknown".
- building_text: the building or tower name exactly as written, without unit or floor numbers. Null if no building is named.
- area_text: the community or area, e.g. "Dubai Marina" or "JVC". Null if not shown.
- bedrooms: an integer; a studio is 0. Ignore maids rooms and study rooms.
- size_sqft: the built-up area in square feet. Convert square metres by multiplying by 10.7639.
- price_aed: the full asking price in AED as a plain number, e.g. "2.45M" becomes 2450000. Convert other currencies only if the AED price is not shown; otherwise null.
- If several properties appear, use the most prominent one.
- Never guess. A value that is not visible in the input is null."""


def _prepare_image(data: bytes, max_edge: int = 1568) -> tuple[str, str]:
    img = Image.open(io.BytesIO(data))
    img = img.convert("RGB")
    if max(img.size) > max_edge:
        img.thumbnail((max_edge, max_edge))
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=88)
    return "image/jpeg", base64.standard_b64encode(buf.getvalue()).decode()


class Extractor:
    def __init__(self, client: anthropic.AsyncAnthropic | None = None):
        self.client = client or anthropic.AsyncAnthropic()

    async def read(self, image: bytes | None = None, text: str | None = None) -> ListingFields:
        content: list[dict] = []
        if image is not None:
            media_type, b64 = _prepare_image(image)
            content.append({"type": "image", "source": {"type": "base64", "media_type": media_type, "data": b64}})
        if text:
            content.append({"type": "text", "text": f"Listing text:\n{text[:4000]}"})
        content.append({"type": "text", "text": "Extract the listing facts."})

        try:
            response = await self.client.beta.messages.create(
                model=settings.claude_model,
                max_tokens=2048,
                system=SYSTEM,
                messages=[{"role": "user", "content": content}],
                output_config={"effort": settings.claude_effort, "format": {"type": "json_schema", "schema": SCHEMA}},
                # If a safety classifier declines, the API retries on a fallback model in the same call.
                betas=["server-side-fallback-2026-07-01"],
                fallbacks="default",
            )
        except anthropic.RateLimitError as e:
            log.warning("Claude rate limited: %s", e)
            raise ExtractionError("I'm busy right now. Please send it again in a minute.") from e
        except anthropic.APIStatusError as e:
            log.error("Claude API error %s: %s", e.status_code, e.message)
            raise ExtractionError("I couldn't read that just now. Please try again.") from e
        except anthropic.APIConnectionError as e:
            log.error("Claude connection error: %s", e)
            raise ExtractionError("I couldn't read that just now. Please try again.") from e

        if response.stop_reason == "refusal":
            raise ExtractionError("I can't read this image. Please send a screenshot of the listing.")
        if response.stop_reason == "max_tokens":
            raise ExtractionError("I couldn't read that listing. Please try a clearer screenshot.")

        raw = next((b.text for b in response.content if b.type == "text"), "")
        try:
            return ListingFields.model_validate(json.loads(raw))
        except (json.JSONDecodeError, ValidationError) as e:
            log.error("Bad extraction output: %r (%s)", raw[:500], e)
            raise ExtractionError("I couldn't read that listing. Please try a clearer screenshot.") from e
