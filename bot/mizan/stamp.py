"""Draw the Mizan stamp onto the user's own screenshot, plus a footer that carries the share link."""
from __future__ import annotations

import io
import textwrap
from functools import lru_cache
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw, ImageFont

from .compare import Result, beds_label, fmt_aed, fmt_pct

INK = (58, 55, 201)          # stamp ink
BRAND = (15, 76, 92)         # footer band
PAPER = (246, 247, 244)
WIDTH = 1080

_FONT_DIRS = [Path("C:/Windows/Fonts"), Path("/usr/share/fonts/truetype/dejavu"),
              Path("/usr/share/fonts/dejavu"), Path("/Library/Fonts"), Path(__file__).parent / "fonts"]
_FONTS = {
    "bold": ["arialbd.ttf", "DejaVuSans-Bold.ttf", "Arial Bold.ttf"],
    "regular": ["arial.ttf", "DejaVuSans.ttf", "Arial.ttf"],
    "narrow": ["ARIALNB.TTF", "DejaVuSansCondensed-Bold.ttf", "Arial Narrow Bold.ttf", "arialbd.ttf"],
}


@lru_cache(maxsize=64)
def font(kind: str, size: int) -> ImageFont.FreeTypeFont:
    for name in _FONTS[kind]:
        for d in _FONT_DIRS:
            p = d / name
            if p.exists():
                return ImageFont.truetype(str(p), size)
    return ImageFont.load_default(size=size)


def _fit(draw: ImageDraw.ImageDraw, text: str, kind: str, max_w: int, start: int, min_size: int = 10):
    size = start
    while size > min_size and draw.textlength(text, font=font(kind, size)) > max_w:
        size -= 2
    return font(kind, size)


def _stamp_layer(width: int, big: str, line1: str, line2: str, seed: int) -> Image.Image:
    w, h = width, int(width * 0.56)
    layer = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    outer = max(4, w // 50)
    d.rounded_rectangle([outer // 2, outer // 2, w - outer // 2, h - outer // 2], radius=w // 18, outline=INK, width=outer)
    pad = int(w * 0.045)
    d.rounded_rectangle([pad, pad, w - pad, h - pad], radius=w // 30, outline=INK, width=max(2, w // 160))

    inner = w - 2 * pad - int(w * 0.14)
    cx = w // 2
    head = font("bold", int(w * 0.052))
    d.text((cx, int(h * 0.19)), "M I Z A N   ·   C H E C K E D", font=head, fill=INK, anchor="mm")
    big_font = _fit(d, big, "narrow", inner, int(h * 0.36))
    d.text((cx, int(h * 0.47)), big, font=big_font, fill=INK, anchor="mm")
    y_rule = int(h * 0.67)
    d.line([pad + int(w * 0.06), y_rule, w - pad - int(w * 0.06), y_rule], fill=INK, width=max(2, w // 200))
    d.text((cx, int(h * 0.76)), line1, font=_fit(d, line1, "bold", inner, int(w * 0.05)), fill=INK, anchor="mm")
    d.text((cx, int(h * 0.865)), line2, font=_fit(d, line2, "regular", inner, int(w * 0.044)), fill=INK, anchor="mm")

    # Ink texture: knock small speckles out of the stamp so it reads as a rubber stamp.
    noise = Image.effect_noise((w, h), 64).point(lambda v: 0 if v > 205 else 255)
    if seed % 2:
        noise = noise.transpose(Image.Transpose.FLIP_LEFT_RIGHT)
    r, g, b, a = layer.split()
    a = ImageChops.multiply(a, noise).point(lambda v: int(v * 0.88))
    layer = Image.merge("RGBA", (r, g, b, a))
    return layer.rotate(9, resample=Image.Resampling.BICUBIC, expand=True)


def _plain_listing(price: float, beds: int, size: float, building: str) -> Image.Image:
    img = Image.new("RGB", (WIDTH, 1000), PAPER)  # text on top, stamp in the lower half
    d = ImageDraw.Draw(img)
    d.text((64, 90), "Listing details", font=font("bold", 34), fill=(90, 104, 108))
    d.text((64, 160), fmt_aed(price), font=font("bold", 86), fill=(19, 39, 44))
    d.text((64, 290), f"{beds_label(beds)} · {size:,.0f} sq ft", font=font("regular", 46), fill=(19, 39, 44))
    d.text((64, 360), building, font=font("bold", 46), fill=(19, 39, 44))
    return img


def render_card(*, result: Result, beds: int, size_sqft: float, price_aed: float, building: str,
                code: str, share_link: str, screenshot: bytes | None = None, demo: bool = True) -> bytes:
    if screenshot:
        base = Image.open(io.BytesIO(screenshot)).convert("RGB")
        base = base.resize((WIDTH, round(base.height * WIDTH / base.width)), Image.Resampling.LANCZOS)
        base = base.crop((0, 0, WIDTH, min(base.height, int(WIDTH * 2.4))))  # cap very long screenshots
    else:
        base = _plain_listing(price_aed, beds, size_sqft, building)

    if result.enough:
        big = fmt_pct(result.diff)
        line1 = f"vs median of {result.count} registered sales"
        line2 = f"{beds_label(beds)} · last 12 months · per sq ft"
    else:
        big = "NO VERDICT"
        line1 = f"only {result.count} registered sale{'s' if result.count != 1 else ''} in 12 months"
        line2 = "need 3 · tap Alert me"

    stamp = _stamp_layer(int(WIDTH * 0.64), big, line1, line2, seed=sum(map(ord, code)))
    x = WIDTH - stamp.width - int(WIDTH * 0.03)
    if screenshot:  # over the photo area, near the top of a listing
        y = max(int(base.height * 0.04), int(base.height * 0.30) - stamp.height // 2)
    else:           # below the typed details
        y = base.height - stamp.height - int(WIDTH * 0.03)
    y = min(y, max(0, base.height - stamp.height))
    canvas = base.convert("RGBA")
    canvas.alpha_composite(stamp, (x, y))

    # Footer: the verdict in words, the numbers behind it, and the share link.
    if result.enough:
        direction = "above" if result.diff >= 0 else "below"
        headline = (f"{fmt_pct(result.diff).lstrip('+−')} {direction} the median of {result.count} registered "
                    f"{beds_label(beds)} sales in {building}")
        detail = f"Asking {fmt_aed(result.asking_psf)}/sq ft · median {fmt_aed(result.median_psf)}/sq ft · last 12 months"
    else:
        headline = f"Too few registered {beds_label(beds)} sales in {building} to judge yet"
        detail = f"Asking {fmt_aed(result.asking_psf)}/sq ft · {result.count} sale(s) in the last 12 months"

    pad = 48
    head_font, detail_font, link_font = font("bold", 40), font("regular", 30), font("bold", 30)
    head_lines = textwrap.wrap(headline, width=44)
    foot_h = pad + len(head_lines) * 52 + 12 + 44 + 24 + 44 + pad
    out = Image.new("RGB", (WIDTH, canvas.height + foot_h), BRAND)
    out.paste(canvas.convert("RGB"), (0, 0))
    d = ImageDraw.Draw(out)
    y = canvas.height + pad
    for line in head_lines:
        d.text((pad, y), line, font=head_font, fill=(255, 255, 255))
        y += 52
    y += 12
    d.text((pad, y), detail, font=_fit(d, detail, "regular", WIDTH - 2 * pad, 30), fill=(200, 226, 231))
    y += 44 + 24
    tag = "DEMO DATA"
    tw = d.textlength(tag, font=link_font)
    link_text = f"Check any Dubai listing: {share_link}"
    link_room = WIDTH - 2 * pad - (int(tw) + 28 + 24 if demo else 0)
    d.text((pad, y), link_text, font=_fit(d, link_text, "bold", link_room, 30), fill=(255, 255, 255))
    if demo:
        d.rounded_rectangle([WIDTH - pad - tw - 28, y - 6, WIDTH - pad, y + 40], radius=10, fill=(255, 196, 92))
        d.text((WIDTH - pad - tw - 14, y), tag, font=link_font, fill=(40, 30, 0))

    buf = io.BytesIO()
    out.save(buf, format="JPEG", quality=90)
    return buf.getvalue()
