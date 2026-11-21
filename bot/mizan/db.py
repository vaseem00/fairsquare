"""SQLite storage. One file, no server. Small enough to run on any cheap VPS."""
from __future__ import annotations

import secrets
import sqlite3
from contextlib import contextmanager
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Iterator

from .config import settings

SCHEMA = """
CREATE TABLE IF NOT EXISTS buildings (
    id              INTEGER PRIMARY KEY,
    name            TEXT NOT NULL UNIQUE,      -- tower name people use
    area            TEXT NOT NULL,             -- community, e.g. Dubai Marina
    project         TEXT,                      -- registered project name
    master_project  TEXT,
    is_demo         INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS aliases (
    alias        TEXT NOT NULL,                -- normalised text as it appears in listings
    building_id  INTEGER NOT NULL REFERENCES buildings(id) ON DELETE CASCADE,
    PRIMARY KEY (alias, building_id)
);
CREATE TABLE IF NOT EXISTS sales (
    id           INTEGER PRIMARY KEY,
    building_id  INTEGER NOT NULL REFERENCES buildings(id) ON DELETE CASCADE,
    sale_date    TEXT NOT NULL,                -- ISO date of registration
    beds         INTEGER NOT NULL,             -- 0 = studio
    size_sqft    REAL NOT NULL,
    price_aed    REAL NOT NULL,
    source       TEXT NOT NULL DEFAULT 'demo'
);
CREATE INDEX IF NOT EXISTS sales_lookup ON sales(building_id, beds, sale_date);

CREATE TABLE IF NOT EXISTS users (
    tg_id        INTEGER PRIMARY KEY,
    first_seen   TEXT NOT NULL,
    referred_by  TEXT                          -- card code that brought them in
);
CREATE TABLE IF NOT EXISTS checks (
    id           INTEGER PRIMARY KEY,
    code         TEXT NOT NULL UNIQUE,         -- printed on the card, used in share links
    tg_id        INTEGER NOT NULL,
    created      TEXT NOT NULL,
    building_id  INTEGER REFERENCES buildings(id),
    building_text TEXT,
    beds         INTEGER,
    size_sqft    REAL,
    price_aed    REAL,
    asking_psf   REAL,
    median_psf   REAL,
    sales_count  INTEGER,
    diff_pct     REAL,                         -- NULL when too few sales
    band         TEXT
);
CREATE TABLE IF NOT EXISTS watches (
    check_id     INTEGER PRIMARY KEY REFERENCES checks(id) ON DELETE CASCADE,
    tg_id        INTEGER NOT NULL,
    last_count   INTEGER NOT NULL,
    created      TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS consents (
    id           INTEGER PRIMARY KEY,
    tg_id        INTEGER NOT NULL,
    check_id     INTEGER REFERENCES checks(id),
    partner      TEXT NOT NULL,
    consent_text TEXT NOT NULL,                -- version of the wording shown
    given_at     TEXT NOT NULL,
    phone        TEXT,
    sent_at      TEXT,                         -- when the lead reached the partner
    withdrawn_at TEXT
);
CREATE TABLE IF NOT EXISTS unknown_buildings (
    text         TEXT PRIMARY KEY,             -- buildings people asked for that we don't cover
    asks         INTEGER NOT NULL DEFAULT 1,
    last_asked   TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS alias_votes (
    alias        TEXT NOT NULL,
    building_id  INTEGER NOT NULL,
    votes        INTEGER NOT NULL DEFAULT 1,
    PRIMARY KEY (alias, building_id)
);
"""


def now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def connect(path: Path | None = None) -> sqlite3.Connection:
    path = path or settings.db_path
    path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(path)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


@contextmanager
def tx(conn: sqlite3.Connection) -> Iterator[sqlite3.Connection]:
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise


def init(conn: sqlite3.Connection) -> None:
    conn.executescript(SCHEMA)
    conn.commit()


# ---------- buildings and sales ----------

def add_building(conn, name, area, project=None, master_project=None, is_demo=False, aliases=()) -> int:
    from .matching import normalise

    cur = conn.execute(
        "INSERT INTO buildings(name, area, project, master_project, is_demo) VALUES (?,?,?,?,?) "
        "ON CONFLICT(name) DO UPDATE SET area=excluded.area, project=excluded.project, "
        "master_project=excluded.master_project RETURNING id",
        (name, area, project, master_project, int(is_demo)),
    )
    bid = cur.fetchone()[0]
    for a in {name, *aliases}:
        conn.execute("INSERT OR IGNORE INTO aliases(alias, building_id) VALUES (?,?)", (normalise(a), bid))
    return bid


def add_sale(conn, building_id, sale_date: str, beds: int, size_sqft: float, price_aed: float, source="demo") -> None:
    conn.execute(
        "INSERT INTO sales(building_id, sale_date, beds, size_sqft, price_aed, source) VALUES (?,?,?,?,?,?)",
        (building_id, sale_date, beds, size_sqft, price_aed, source),
    )


def all_aliases(conn) -> list[sqlite3.Row]:
    return conn.execute(
        "SELECT a.alias, b.id, b.name, b.area FROM aliases a JOIN buildings b ON b.id = a.building_id"
    ).fetchall()


def building(conn, building_id: int) -> sqlite3.Row | None:
    return conn.execute("SELECT * FROM buildings WHERE id = ?", (building_id,)).fetchone()


def building_count(conn) -> int:
    return conn.execute("SELECT COUNT(*) FROM buildings").fetchone()[0]


def recent_sales(conn, building_id: int, beds: int, today: date | None = None, days: int | None = None):
    today = today or date.today()
    since = (today - timedelta(days=days or settings.window_days)).isoformat()
    return conn.execute(
        "SELECT sale_date, size_sqft, price_aed FROM sales "
        "WHERE building_id = ? AND beds = ? AND sale_date >= ? AND sale_date <= ? ORDER BY sale_date DESC",
        (building_id, beds, since, today.isoformat()),
    ).fetchall()


# ---------- users, checks, watches ----------

def touch_user(conn, tg_id: int, referred_by: str | None = None) -> bool:
    """Create the user if new. Returns True when the user is new."""
    cur = conn.execute(
        "INSERT OR IGNORE INTO users(tg_id, first_seen, referred_by) VALUES (?,?,?)",
        (tg_id, now_iso(), referred_by),
    )
    conn.commit()
    return cur.rowcount == 1


def checks_today(conn, tg_id: int) -> int:
    start = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0).isoformat()
    return conn.execute("SELECT COUNT(*) FROM checks WHERE tg_id = ? AND created >= ?", (tg_id, start)).fetchone()[0]


def new_code(conn) -> str:
    alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
    while True:
        code = "".join(secrets.choice(alphabet) for _ in range(6))
        if not conn.execute("SELECT 1 FROM checks WHERE code = ?", (code,)).fetchone():
            return code


def save_check(conn, tg_id, building_id, building_text, beds, size_sqft, price_aed, result) -> sqlite3.Row:
    code = new_code(conn)
    with tx(conn):
        cur = conn.execute(
            "INSERT INTO checks(code, tg_id, created, building_id, building_text, beds, size_sqft, price_aed, "
            "asking_psf, median_psf, sales_count, diff_pct, band) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?) RETURNING *",
            (code, tg_id, now_iso(), building_id, building_text, beds, size_sqft, price_aed,
             result.asking_psf, result.median_psf, result.count,
             None if result.diff is None else round(result.diff * 100, 2), result.band),
        )
        return cur.fetchone()


def get_check(conn, check_id: int) -> sqlite3.Row | None:
    return conn.execute("SELECT * FROM checks WHERE id = ?", (check_id,)).fetchone()


def add_watch(conn, check_id: int, tg_id: int, count: int) -> None:
    with tx(conn):
        conn.execute(
            "INSERT OR REPLACE INTO watches(check_id, tg_id, last_count, created) VALUES (?,?,?,?)",
            (check_id, tg_id, count, now_iso()),
        )


def list_watches(conn, tg_id: int | None = None):
    sql = "SELECT w.*, c.* FROM watches w JOIN checks c ON c.id = w.check_id"
    if tg_id is None:
        return conn.execute(sql).fetchall()
    return conn.execute(sql + " WHERE w.tg_id = ? ORDER BY c.created DESC", (tg_id,)).fetchall()


def update_watch_count(conn, check_id: int, count: int) -> None:
    with tx(conn):
        conn.execute("UPDATE watches SET last_count = ? WHERE check_id = ?", (count, check_id))


def stop_watches(conn, tg_id: int) -> int:
    with tx(conn):
        return conn.execute("DELETE FROM watches WHERE tg_id = ?", (tg_id,)).rowcount


# ---------- consent and leads ----------

def record_consent(conn, tg_id, check_id, partner, consent_text, phone) -> int:
    with tx(conn):
        cur = conn.execute(
            "INSERT INTO consents(tg_id, check_id, partner, consent_text, given_at, phone) VALUES (?,?,?,?,?,?)",
            (tg_id, check_id, partner, consent_text, now_iso(), phone),
        )
        return cur.lastrowid


def mark_lead_sent(conn, consent_id: int) -> None:
    with tx(conn):
        conn.execute("UPDATE consents SET sent_at = ? WHERE id = ?", (now_iso(), consent_id))


def delete_user_data(conn, tg_id: int) -> None:
    """Delete everything we hold about a person. Consents are kept as withdrawn records without the phone."""
    with tx(conn):
        conn.execute("UPDATE consents SET phone = NULL, withdrawn_at = ? WHERE tg_id = ?", (now_iso(), tg_id))
        conn.execute("DELETE FROM watches WHERE tg_id = ?", (tg_id,))
        conn.execute("UPDATE consents SET check_id = NULL WHERE tg_id = ?", (tg_id,))
        conn.execute("DELETE FROM checks WHERE tg_id = ?", (tg_id,))
        conn.execute("DELETE FROM users WHERE tg_id = ?", (tg_id,))


# ---------- learning signals ----------

def log_unknown_building(conn, text: str) -> None:
    with tx(conn):
        conn.execute(
            "INSERT INTO unknown_buildings(text, asks, last_asked) VALUES (?,1,?) "
            "ON CONFLICT(text) DO UPDATE SET asks = asks + 1, last_asked = excluded.last_asked",
            (text.strip()[:120], now_iso()),
        )


def vote_alias(conn, alias: str, building_id: int) -> None:
    with tx(conn):
        conn.execute(
            "INSERT INTO alias_votes(alias, building_id) VALUES (?,?) "
            "ON CONFLICT(alias, building_id) DO UPDATE SET votes = votes + 1",
            (alias, building_id),
        )


def stats(conn) -> dict:
    q = lambda sql: conn.execute(sql).fetchone()[0]  # noqa: E731
    return {
        "users": q("SELECT COUNT(*) FROM users"),
        "users_from_cards": q("SELECT COUNT(*) FROM users WHERE referred_by IS NOT NULL"),
        "checks": q("SELECT COUNT(*) FROM checks"),
        "checks_7d": q("SELECT COUNT(*) FROM checks WHERE created >= datetime('now','-7 days')"),
        "watches": q("SELECT COUNT(*) FROM watches"),
        "leads": q("SELECT COUNT(*) FROM consents WHERE withdrawn_at IS NULL"),
        "top_unknown": conn.execute(
            "SELECT text, asks FROM unknown_buildings ORDER BY asks DESC LIMIT 10"
        ).fetchall(),
    }
