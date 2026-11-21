# Mizan Telegram bot

Forward a Dubai listing screenshot (or paste the listing text). Mizan reads it, asks you to confirm the building, compares the asking price per sq ft with registered same-bedroom sales in that building over the last 12 months, and sends your screenshot back with a stamp.

The bot runs on fictional demo data until you load sales data you have the right to use.

## What it does

| Step | What happens | Code |
|---|---|---|
| Read | Claude reads the building, bedrooms, size and price from the screenshot or text | `mizan/extract.py` |
| Fill gaps | If a value is missing or looks wrong, the bot asks the user to type it | `mizan/textparse.py` |
| Match | Proposes up to 3 buildings; the user confirms with one tap | `mizan/matching.py` |
| Compare | Median AED/sq ft of same-bedroom sales in 12 months; needs at least 3 sales | `mizan/compare.py` |
| Stamp | Draws the stamp on the user's screenshot, with a footer carrying a share link | `mizan/stamp.py` |
| Share loop | Each card has a code; `t.me/<bot>?start=c_<code>` records which card brought a new user | `mizan/bot.py` |
| Money | Monthly cost estimate → opt-in → user shares their own phone number → lead goes to one named partner | `mizan/bot.py` |
| Retention | "Alert me" saves a listing; a daily job messages the user when a new sale registers | `mizan/bot.py` |

Commands: `/start`, `/saved`, `/stopalerts`, `/privacy`, `/delete`, and `/stats` (admin only: users, users from shared cards, checks, leads, and the buildings people asked for that you don't cover yet).

## Set up

1. In Telegram, message **@BotFather** → `/newbot` → copy the token.
2. Get an Anthropic API key at console.anthropic.com.
3. Copy `.env.example` to `.env` and fill in `TELEGRAM_BOT_TOKEN` and `ANTHROPIC_API_KEY`. Add your own Telegram user ID as `ADMIN_USER_ID` (ask @userinfobot).
4. Install and run:

```bash
python -m venv .venv
# Windows: .venv\Scripts\activate     Linux/macOS: source .venv/bin/activate
pip install -r requirements.txt
python run.py
```

The first run creates `data/mizan.sqlite3` and loads six fictional buildings. To try it, send the bot a listing that mentions "Marina Crest, Dubai Marina, 2 bed, 1,284 sq ft, AED 2,450,000".

### Offline checks (no Telegram, no Claude)

```bash
python -m unittest discover tests        # 13 tests
python scripts/render_sample.py          # writes sample cards to data/samples/
```

### Note for this PC

Windows Application Control on this machine blocks `jiter`, a compiled file the Anthropic SDK needs. Tests and card rendering work here, but the bot itself won't start on this PC. Run it on a small Linux server (any USD 5/month VPS) or on a machine without that policy. Ask your IT team rather than working around the policy.

## Run it on a server

```bash
sudo apt install python3-venv
git clone <your repo> mizan-bot && cd mizan-bot
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
cp .env.example .env && nano .env
```

To keep it running, create `/etc/systemd/system/mizan.service`:

```ini
[Unit]
Description=Mizan bot
After=network-online.target

[Service]
WorkingDirectory=/home/ubuntu/mizan-bot
ExecStart=/home/ubuntu/mizan-bot/.venv/bin/python run.py
Restart=always

[Install]
WantedBy=multi-user.target
```

Then run `sudo systemctl enable --now mizan`.

## Load real sales data

```bash
python scripts/import_sales.py --buildings buildings.csv --sales sales.csv --source licensed-2026-11
python scripts/import_sales.py --clear-demo
```

Then set `DEMO_MODE=false`. The CSV formats are described at the top of `scripts/import_sales.py`. Building the alias list (listing nicknames → building) for your first 100 buildings is the main manual job. `/stats` shows which buildings people ask for, so you know which to add next.

## Before you go public

- **Data rights.** Dubai Land Department open data is offered for personal, non-commercial use. Get written permission or use a licensed provider before the bot answers the public with real sales.
- **Getting paid.** Only licensed brokers may broker property in Dubai. Sign a written introducer agreement with one licensed mortgage broker, set `PARTNER_NAME` and `PARTNER_CHAT_ID`, and get one hour of UAE legal advice before taking a fee.
- **Consent.** The bot passes a lead only after the user taps "Talk to a mortgage adviser", reads which partner gets it, and shares their own phone number. Each consent is logged with its wording version (`optin-v1`). `/delete` withdraws it and removes the phone number.
- **Cost.** Each check is one Claude call (model `claude-opus-5-5`, effort `low`). `DAILY_CHECK_LIMIT` caps checks per user per day.

## Known limits

- Sale listings for apartments only. Rentals, villas and off-plan projects are not handled.
- The stamp compares the listing with the building's median. Floor, view and condition are not taken into account.
- Building matching only suggests candidates. Users confirm, and their taps are stored in `alias_votes` for you to review. They are not applied automatically.
- The alert job sends text only. Users re-send the screenshot to get a fresh stamp.
