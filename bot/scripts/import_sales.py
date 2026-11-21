"""Import buildings and sales from CSV files.

Only import data you have the right to use commercially. Dubai Land Department open data
is offered for personal, non-commercial use; get written permission or use a licensed
provider before the bot answers the public with it.

buildings.csv columns:  name, area, project, master_project, aliases   (aliases separated by "|")
sales.csv columns:      building, sale_date (YYYY-MM-DD), beds (0 = studio), size_sqft, price_aed

Usage:
    python scripts/import_sales.py --buildings buildings.csv --sales sales.csv --source licensed-2026-11
    python scripts/import_sales.py --clear-demo      # remove the fictional demo buildings
"""
from __future__ import annotations

import argparse
import csv
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from mizan import db  # noqa: E402


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--buildings", type=Path)
    ap.add_argument("--sales", type=Path)
    ap.add_argument("--source", default="import")
    ap.add_argument("--clear-demo", action="store_true")
    args = ap.parse_args()

    conn = db.connect()
    db.init(conn)

    if args.clear_demo:
        with db.tx(conn):
            n = conn.execute("DELETE FROM buildings WHERE is_demo = 1").rowcount
        print(f"Removed {n} demo buildings and their sales.")

    if args.buildings:
        with db.tx(conn), args.buildings.open(newline="", encoding="utf-8-sig") as f:
            n = 0
            for row in csv.DictReader(f):
                aliases = [a.strip() for a in (row.get("aliases") or "").split("|") if a.strip()]
                db.add_building(conn, row["name"].strip(), row["area"].strip(), row.get("project"),
                                row.get("master_project"), is_demo=False, aliases=aliases)
                n += 1
        print(f"Imported {n} buildings.")

    if args.sales:
        ids = {r["name"].lower(): r["id"] for r in conn.execute("SELECT id, name FROM buildings")}
        added, skipped = 0, []
        with db.tx(conn), args.sales.open(newline="", encoding="utf-8-sig") as f:
            for i, row in enumerate(csv.DictReader(f), start=2):
                bid = ids.get(row["building"].strip().lower())
                if not bid:
                    skipped.append(f"line {i}: unknown building {row['building']!r}")
                    continue
                db.add_sale(conn, bid, row["sale_date"].strip(), int(row["beds"]), float(row["size_sqft"]),
                            float(row["price_aed"]), args.source)
                added += 1
        print(f"Imported {added} sales.")
        if skipped:
            print(f"Skipped {len(skipped)} rows:\n  " + "\n  ".join(skipped[:20]))


if __name__ == "__main__":
    main()
