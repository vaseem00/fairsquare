"""Settings, read once from environment variables (or a .env file)."""
from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parent.parent
load_dotenv(ROOT / ".env")


def _int(name: str, default: int | None) -> int | None:
    raw = os.getenv(name, "").strip()
    return int(raw) if raw else default


def _float(name: str, default: float) -> float:
    raw = os.getenv(name, "").strip()
    return float(raw) if raw else default


@dataclass(frozen=True)
class Settings:
    telegram_token: str = os.getenv("TELEGRAM_BOT_TOKEN", "").strip()
    db_path: Path = Path(os.getenv("MIZAN_DB", str(ROOT / "data" / "mizan.sqlite3")))

    # Claude model that reads screenshots. Effort "low" is enough for field extraction.
    claude_model: str = os.getenv("CLAUDE_MODEL", "claude-opus-5-5").strip()
    claude_effort: str = os.getenv("CLAUDE_EFFORT", "low").strip()

    # Demo mode stamps every answer with "demo data" so nobody mistakes it for real sales.
    demo_mode: bool = os.getenv("DEMO_MODE", "true").strip().lower() in {"1", "true", "yes"}

    # Comparison rules
    min_sales: int = _int("MIN_SALES", 3)
    window_days: int = _int("WINDOW_DAYS", 365)
    band_pct: float = _float("BAND_PCT", 5.0)  # within +/- this % counts as "in line"

    # Abuse and cost guard: checks per user per day
    daily_check_limit: int = _int("DAILY_CHECK_LIMIT", 20)

    # Mortgage estimate defaults (shown to the user as estimates)
    mortgage_rate_pct: float = _float("MORTGAGE_RATE_PCT", 4.25)
    mortgage_years: int = _int("MORTGAGE_YEARS", 25)

    # The one named partner who receives opted-in leads
    partner_name: str = os.getenv("PARTNER_NAME", "Demo Mortgage Partner").strip()
    partner_chat_id: int | None = _int("PARTNER_CHAT_ID", None)

    # Your own Telegram user id, for /stats
    admin_user_id: int | None = _int("ADMIN_USER_ID", None)

    # Daily alert run, in UTC (02:00 UTC = 06:00 Dubai)
    alert_hour_utc: int = _int("ALERT_HOUR_UTC", 2)


settings = Settings()
CONSENT_VERSION = "optin-v1"
