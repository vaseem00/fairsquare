"""Render sample stamped cards without Telegram or Claude, to check the design.

    python scripts/render_sample.py          -> writes data/samples/*.jpg
"""
from __future__ import annotations

import sys
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from mizan import db, seed_demo  # noqa: E402
from mizan.compare import analyse  # noqa: E402
from mizan.stamp import render_card  # noqa: E402

CASES = [
    ("above", "Marina Crest Tower", 2, 1284, 2450000),
    ("inline", "Palm Vista Residences", 1, 742, 865000),
    ("thin", "Creekside Heights 2", 3, 1905, 3600000),
]


def main() -> None:
    out = Path(__file__).resolve().parent.parent / "data" / "samples"
    out.mkdir(parents=True, exist_ok=True)
    conn = db.connect(Path(":memory:"))
    db.init(conn)
    seed_demo.seed(conn, date.today())
    for label, name, beds, size, price in CASES:
        bid = conn.execute("SELECT id FROM buildings WHERE name = ?", (name,)).fetchone()[0]
        result = analyse(price, size, db.recent_sales(conn, bid, beds))
        jpg = render_card(result=result, beds=beds, size_sqft=size, price_aed=price, building=name,
                          code="7Q2KXM", share_link="t.me/MizanCheckBot?start=c_7Q2KXM", demo=True)
        path = out / f"card_{label}.jpg"
        path.write_bytes(jpg)
        print(f"{path}  band={result.band}  sales={result.count}  diff={result.diff}")


if __name__ == "__main__":
    main()
