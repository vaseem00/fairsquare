"""Offline tests: no Telegram, no Claude. Run with:  python -m unittest discover tests"""
from __future__ import annotations

import io
import sys
import unittest
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from PIL import Image  # noqa: E402

from mizan import db, seed_demo  # noqa: E402
from mizan.compare import analyse, fmt_pct  # noqa: E402
from mizan.fields import ListingFields  # noqa: E402
from mizan.matching import candidates, normalise  # noqa: E402
from mizan.mortgage import estimate  # noqa: E402
from mizan.stamp import render_card  # noqa: E402
from mizan.textparse import parse_fields  # noqa: E402

TODAY = date(2026, 11, 17)
_OPEN = []


def demo_conn():
    conn = db.connect(Path(":memory:"))
    db.init(conn)
    seed_demo.seed(conn, TODAY)
    _OPEN.append(conn)
    return conn


def tearDownModule():
    for c in _OPEN:
        c.close()


def bid(conn, name):
    return conn.execute("SELECT id FROM buildings WHERE name = ?", (name,)).fetchone()[0]


class CompareTests(unittest.TestCase):
    def test_above(self):
        conn = demo_conn()
        r = analyse(2450000, 1284, db.recent_sales(conn, bid(conn, "Marina Crest Tower"), 2, TODAY))
        self.assertEqual(r.count, 11)
        self.assertEqual(r.band, "above")
        self.assertAlmostEqual(r.median_psf, 2150000 / 1284, places=3)
        self.assertEqual(fmt_pct(r.diff), "+14.0%")

    def test_inline(self):
        conn = demo_conn()
        r = analyse(865000, 742, db.recent_sales(conn, bid(conn, "Palm Vista Residences"), 1, TODAY))
        self.assertEqual(r.band, "inline")
        self.assertLess(abs(r.diff), 0.05)

    def test_thin(self):
        conn = demo_conn()
        r = analyse(3600000, 1905, db.recent_sales(conn, bid(conn, "Creekside Heights 2"), 3, TODAY))
        self.assertEqual((r.band, r.count, r.diff), ("thin", 2, None))

    def test_other_bedrooms_and_old_sales_excluded(self):
        conn = demo_conn()
        b = bid(conn, "Marina Crest Tower")
        db.add_sale(conn, b, "2025-01-01", 2, 1284, 9_000_000)   # older than 12 months
        db.add_sale(conn, b, "2026-10-01", 3, 1600, 9_000_000)   # different bedroom count
        self.assertEqual(len(db.recent_sales(conn, b, 2, TODAY)), 11)


class MatchingTests(unittest.TestCase):
    def test_nickname_with_area(self):
        conn = demo_conn()
        top = candidates("Marina Crest, Dubai Marina", db.all_aliases(conn), "Dubai Marina")
        self.assertEqual(top[0].name, "Marina Crest Tower")

    def test_number_must_agree(self):
        conn = demo_conn()
        self.assertEqual(candidates("Creekside Hts 2", db.all_aliases(conn))[0].name, "Creekside Heights 2")
        self.assertEqual(candidates("Marina Crest II", db.all_aliases(conn))[0].name, "Marina Crest Tower 2")

    def test_abbreviations(self):
        self.assertEqual(normalise("Palm Vista Res., JVC"), "palm vista residences jumeirah village circle")

    def test_unknown_building(self):
        conn = demo_conn()
        self.assertEqual(candidates("Burj Something Else", db.all_aliases(conn)), [])


class ParseTests(unittest.TestCase):
    def test_typed_details(self):
        self.assertEqual(parse_fields("2 bed, 1284 sqft, 2.45m"),
                         {"bedrooms": 2, "size_sqft": 1284.0, "price_aed": 2450000.0})
        self.assertEqual(parse_fields("Studio 420 sq ft AED 690,000"),
                         {"bedrooms": 0, "size_sqft": 420.0, "price_aed": 690000.0})
        self.assertAlmostEqual(parse_fields("3BR 177 sqm 3.6 million")["size_sqft"], 1905.2, places=1)

    def test_missing_fields(self):
        f = ListingFields(is_listing=True, listing_type="sale", building_text="X", bedrooms=2)
        self.assertEqual(f.missing(), ["size_sqft", "price_aed"])


class MortgageTests(unittest.TestCase):
    def test_monthly(self):
        e = estimate(2450000, 20, 4.25, 25)
        self.assertAlmostEqual(e.loan, 1960000)
        self.assertAlmostEqual(e.monthly, 10618, delta=2)


class StampTests(unittest.TestCase):
    def test_renders_on_screenshot_and_plain(self):
        conn = demo_conn()
        r = analyse(2450000, 1284, db.recent_sales(conn, bid(conn, "Marina Crest Tower"), 2, TODAY))
        shot = io.BytesIO()
        Image.new("RGB", (720, 1560), (230, 230, 230)).save(shot, format="PNG")
        for screenshot in (shot.getvalue(), None):
            jpg = render_card(result=r, beds=2, size_sqft=1284, price_aed=2450000, building="Marina Crest Tower",
                              code="ABC123", share_link="t.me/x?start=c_ABC123", screenshot=screenshot)
            img = Image.open(io.BytesIO(jpg))
            self.assertEqual(img.width, 1080)
            self.assertGreater(img.height, 700)


class PrivacyTests(unittest.TestCase):
    def test_delete_user_data(self):
        conn = demo_conn()
        db.touch_user(conn, 42)
        r = analyse(2450000, 1284, db.recent_sales(conn, bid(conn, "Marina Crest Tower"), 2, TODAY))
        c = db.save_check(conn, 42, bid(conn, "Marina Crest Tower"), "Marina Crest", 2, 1284, 2450000, r)
        db.add_watch(conn, c["id"], 42, r.count)
        db.record_consent(conn, 42, c["id"], "P", "optin-v1", "+971500000000")
        db.delete_user_data(conn, 42)
        self.assertIsNone(db.get_check(conn, c["id"]))
        row = conn.execute("SELECT phone, withdrawn_at FROM consents WHERE tg_id = 42").fetchone()
        self.assertIsNone(row["phone"])
        self.assertIsNotNone(row["withdrawn_at"])


if __name__ == "__main__":
    unittest.main()
