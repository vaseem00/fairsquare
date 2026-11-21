"""Fictional buildings and sales for testing. Dates are relative to today so the data never ages out.

Every building here is invented. Replace with licensed data before any public launch.
"""
from __future__ import annotations

from datetime import date, timedelta

from . import db

# (name, area, project, master project, aliases, beds, [(days_ago, size_sqft, price_aed), ...])
DEMO = [
    ("Marina Crest Tower", "Dubai Marina", "MARINA CREST", "Dubai Marina", ["Marina Crest", "Marina Crest Twr"], 2,
     [(40, 1262, 2140000), (57, 1284, 2090000), (76, 1310, 2310000), (95, 1198, 1935000), (113, 1284, 2180000),
      (140, 1262, 2010000), (182, 1340, 2295000), (228, 1284, 2150000), (274, 1198, 1985000),
      (312, 1310, 2235000), (340, 1262, 2085000)]),
    ("Marina Crest Tower 2", "Dubai Marina", "MARINA CREST 2", "Dubai Marina", ["Marina Crest 2", "Marina Crest II"], 2,
     [(22, 1250, 2050000), (88, 1250, 1995000), (150, 1302, 2160000), (260, 1250, 1960000)]),
    ("Palm Vista Residences", "Jumeirah Village Circle", "PALM VISTA", "Jumeirah Village Circle",
     ["Palm Vista Res", "Palm Vista JVC"], 1,
     [(28, 742, 880000), (46, 760, 905000), (67, 735, 860000), (104, 742, 899000), (125, 780, 915000),
      (168, 742, 870000), (209, 735, 845000), (253, 760, 925000), (293, 742, 890000)]),
    ("Palm Vista Residences 2", "Jumeirah Village Circle", "PALM VISTA 2", "Jumeirah Village Circle",
     ["Palm Vista Res 2"], 1,
     [(35, 720, 830000), (120, 720, 815000), (200, 735, 842000)]),
    ("Creekside Heights 2", "Al Jaddaf", "CREEKSIDE HEIGHTS", "Al Jaddaf", ["Creekside Hts 2", "Creekside Heights II"], 3,
     [(110, 1880, 3150000), (279, 1905, 3240000)]),
    ("Creekside Heights 1", "Al Jaddaf", "CREEKSIDE HEIGHTS 1", "Al Jaddaf", ["Creekside Hts 1"], 3,
     [(60, 1850, 3050000), (190, 1850, 3010000), (300, 1880, 3120000)]),
]


def seed(conn, today: date | None = None) -> int:
    """Load the demo buildings if the database has none. Returns the number of sales added."""
    if db.building_count(conn):
        return 0
    today = today or date.today()
    added = 0
    with db.tx(conn):
        for name, area, project, master, aliases, beds, sales in DEMO:
            bid = db.add_building(conn, name, area, project, master, is_demo=True, aliases=aliases)
            for days_ago, size, price in sales:
                db.add_sale(conn, bid, (today - timedelta(days=days_ago)).isoformat(), beds, size, price, "demo")
                added += 1
    return added
