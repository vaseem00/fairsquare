"""Telegram bot: forward a listing, confirm the building, get a stamped card back."""
from __future__ import annotations

import datetime as dt
import html
import logging

from telegram import (InlineKeyboardButton, InlineKeyboardMarkup, KeyboardButton, ReplyKeyboardMarkup,
                      ReplyKeyboardRemove, Update)
from telegram.constants import ChatAction, ParseMode
from telegram.ext import (Application, CallbackQueryHandler, CommandHandler, ContextTypes, MessageHandler,
                          filters)

from . import db, seed_demo
from .compare import analyse, beds_label, fmt_aed, fmt_pct
from .config import CONSENT_VERSION, settings
from .extract import ExtractionError, Extractor
from .fields import ListingFields
from .matching import candidates, normalise
from .mortgage import estimate
from .stamp import render_card
from .textparse import parse_fields

log = logging.getLogger("mizan")

PSF_MIN, PSF_MAX = 300, 6000  # sense check on AED per sq ft
DOWN_OPTIONS = (20, 25, 30, 40)

conn = db.connect()
extractor: Extractor | None = None


def demo_note() -> str:
    return "\n\n<i>Demo data: buildings and sales are fictional.</i>" if settings.demo_mode else ""


def share_link(context: ContextTypes.DEFAULT_TYPE, code: str) -> str:
    return f"t.me/{context.bot.username}?start=c_{code}"


# ---------- commands ----------

async def start(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    ref = None
    if context.args and context.args[0].startswith("c_"):
        ref = context.args[0][2:12]
    db.touch_user(conn, update.effective_user.id, ref)
    await update.message.reply_text(
        "<b>Mizan</b> checks a Dubai listing against what flats in the same building actually sold for.\n\n"
        "1. Screenshot a listing, from a portal, an agent's WhatsApp, anywhere.\n"
        "2. Send it here.\n"
        "3. Get it back stamped with how the price compares to registered sales.\n\n"
        "You can also paste the listing text. Sale listings for apartments only, for now.\n\n"
        "/saved  listings you get alerts for\n/privacy  what I store\n/delete  delete your data"
        + demo_note(),
        parse_mode=ParseMode.HTML,
    )


async def privacy(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    await update.message.reply_text(
        "What I store:\n"
        "• Your Telegram user ID and the listings you check (building, size, price).\n"
        "• Listings you ask me to watch, so I can alert you.\n"
        "• Your phone number only if you choose to talk to a mortgage adviser. "
        f"Then I share it, with that listing, with {settings.partner_name} and nobody else.\n\n"
        "I don't keep your screenshots. Send /delete at any time to remove your data."
    )


async def delete(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    db.delete_user_data(conn, update.effective_user.id)
    context.user_data.clear()
    await update.message.reply_text("Done. Your checks, alerts and phone number are deleted.",
                                    reply_markup=ReplyKeyboardRemove())


async def saved(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    rows = db.list_watches(conn, update.effective_user.id)
    if not rows:
        await update.message.reply_text("You have no saved listings. Tap “Alert me” under a stamp to save one.")
        return
    lines = []
    for r in rows:
        b = db.building(conn, r["building_id"])
        verdict = f"{r['diff_pct']:+.1f}%" if r["diff_pct"] is not None else "no verdict yet"
        lines.append(f"• {b['name']}, {beds_label(r['beds'])}, {fmt_aed(r['price_aed'])}: {verdict}")
    await update.message.reply_text("Alerts are on for:\n" + "\n".join(lines) + "\n\n/stopalerts to turn them off.")


async def stop_alerts(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    n = db.stop_watches(conn, update.effective_user.id)
    await update.message.reply_text(f"Alerts off for {n} listing{'s' if n != 1 else ''}.")


async def stats(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    if update.effective_user.id != settings.admin_user_id:
        return
    s = db.stats(conn)
    unknown = "\n".join(f"  {r['asks']}× {r['text']}" for r in s["top_unknown"]) or "  none"
    await update.message.reply_text(
        f"Users: {s['users']} ({s['users_from_cards']} came from shared cards)\n"
        f"Checks: {s['checks']} ({s['checks_7d']} in 7 days)\n"
        f"Saved listings: {s['watches']}\nLeads with consent: {s['leads']}\n\n"
        f"Buildings people asked for that we don't cover:\n{unknown}"
    )


# ---------- the check flow ----------

async def on_listing(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    msg = update.message
    user = update.effective_user
    db.touch_user(conn, user.id)

    # A text reply may be the missing details we asked for.
    if msg.text and context.user_data.get("awaiting") == "fields":
        await on_missing_fields(update, context)
        return
    if msg.text and context.user_data.get("awaiting") == "building":
        await on_building_typed(update, context)
        return

    if db.checks_today(conn, user.id) >= settings.daily_check_limit:
        await msg.reply_text("You've reached today's limit of checks. Please try again tomorrow.")
        return

    image = None
    if msg.photo:
        image = bytes(await (await msg.photo[-1].get_file()).download_as_bytearray())
    elif msg.document and (msg.document.mime_type or "").startswith("image/"):
        image = bytes(await (await msg.document.get_file()).download_as_bytearray())
    text = msg.caption or msg.text

    await context.bot.send_chat_action(msg.chat_id, ChatAction.TYPING)
    try:
        fields = await extractor.read(image=image, text=text)
    except ExtractionError as e:
        await msg.reply_text(str(e))
        return

    if not fields.is_listing:
        await msg.reply_text("That doesn't look like a property listing. Send a screenshot of a listing with its price.")
        return
    if fields.listing_type == "rent":
        await msg.reply_text("That's a rental listing. I only check sale prices for now.")
        return

    context.user_data["pending"] = {"fields": fields.model_dump(), "image": image}
    await continue_check(update, context)


async def continue_check(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    pending = context.user_data.get("pending")
    if not pending:
        return
    f = ListingFields.model_validate(pending["fields"])
    msg = update.effective_message

    missing = f.missing()
    if missing:
        names = {"bedrooms": "bedrooms", "size_sqft": "size in sq ft", "price_aed": "price"}
        context.user_data["awaiting"] = "fields"
        await msg.reply_text(
            f"I couldn't see the {', '.join(names[m] for m in missing)}. "
            "Reply with them, for example: 2 bed, 1284 sqft, 2.45m"
        )
        return

    psf = f.price_aed / f.size_sqft
    if not PSF_MIN <= psf <= PSF_MAX:
        context.user_data["awaiting"] = "fields"
        await msg.reply_text(
            f"I read {fmt_aed(f.price_aed)} for {f.size_sqft:,.0f} sq ft, which is {fmt_aed(psf)} per sq ft. "
            "That looks wrong. Reply with the correct details, for example: 2 bed, 1284 sqft, 2.45m"
        )
        return

    if not f.building_text:
        context.user_data["awaiting"] = "building"
        await msg.reply_text("Which building is it? Type its name.")
        return

    await ask_building(update, context, f)


async def ask_building(update: Update, context: ContextTypes.DEFAULT_TYPE, f: ListingFields) -> None:
    msg = update.effective_message
    found = candidates(f.building_text, db.all_aliases(conn), area_hint=f.area_text)
    if not found:
        db.log_unknown_building(conn, f.building_text)
        context.user_data.pop("pending", None)
        await msg.reply_text(
            f"I don't have sales data for “{f.building_text}” yet. I cover {db.building_count(conn)} buildings so far "
            "and I've noted this one as requested."
        )
        return
    context.user_data["awaiting"] = None
    buttons = [[InlineKeyboardButton(c.name, callback_data=f"b:{c.building_id}")] for c in found]
    buttons.append([InlineKeyboardButton("Something else", callback_data="b:other")])
    await msg.reply_text(
        f"I read: <b>{html.escape(f.building_text)}</b> · {beds_label(f.bedrooms)} · {f.size_sqft:,.0f} sq ft · "
        f"{fmt_aed(f.price_aed)}\n\nWhich building is it?",
        parse_mode=ParseMode.HTML,
        reply_markup=InlineKeyboardMarkup(buttons),
    )


async def on_missing_fields(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    pending = context.user_data.get("pending")
    if not pending:
        context.user_data["awaiting"] = None
        return
    parsed = parse_fields(update.message.text)
    if not parsed:
        await update.message.reply_text("I couldn't read that. Try: 2 bed, 1284 sqft, 2.45m")
        return
    pending["fields"].update(parsed)
    context.user_data["awaiting"] = None
    await continue_check(update, context)


async def on_building_typed(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    pending = context.user_data.get("pending")
    context.user_data["awaiting"] = None
    if not pending:
        return
    pending["fields"]["building_text"] = update.message.text.strip()[:120]
    await ask_building(update, context, ListingFields.model_validate(pending["fields"]))


async def on_building_chosen(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    q = update.callback_query
    await q.answer()
    pending = context.user_data.get("pending")
    if not pending:
        await q.edit_message_text("That check has expired. Send the screenshot again.")
        return
    choice = q.data.split(":", 1)[1]
    f = ListingFields.model_validate(pending["fields"])
    if choice == "other":
        db.log_unknown_building(conn, f.building_text or "")
        context.user_data["awaiting"] = "building"
        await q.edit_message_text("Type the building name.")
        return

    b = db.building(conn, int(choice))
    if f.building_text:
        db.vote_alias(conn, normalise(f.building_text), b["id"])
    await q.edit_message_text(f"Checking registered {beds_label(f.bedrooms)} sales in {b['name']} "
                              "over the last 12 months…")
    await context.bot.send_chat_action(q.message.chat_id, ChatAction.UPLOAD_PHOTO)

    sales = db.recent_sales(conn, b["id"], f.bedrooms)
    result = analyse(f.price_aed, f.size_sqft, sales)
    check = db.save_check(conn, update.effective_user.id, b["id"], f.building_text, f.bedrooms,
                          f.size_sqft, f.price_aed, result)
    card = render_card(result=result, beds=f.bedrooms, size_sqft=f.size_sqft, price_aed=f.price_aed,
                       building=b["name"], code=check["code"], share_link=share_link(context, check["code"]),
                       screenshot=pending.get("image"), demo=settings.demo_mode or bool(b["is_demo"]))
    context.user_data.pop("pending", None)

    if result.enough:
        direction = "above" if result.diff >= 0 else "below"
        caption = (f"This listing asks <b>{fmt_aed(result.asking_psf)}</b> per sq ft, "
                   f"<b>{fmt_pct(result.diff).lstrip('+−')} {direction}</b> the median of {result.count} registered "
                   f"{beds_label(f.bedrooms)} sales in {html.escape(b['name'])} in the last 12 months "
                   f"({fmt_aed(result.median_psf)} per sq ft).\n\n"
                   "Floor, view and condition can justify a different price. Forward the card to anyone "
                   "you're deciding with.")
    else:
        caption = (f"I found only {result.count} registered {beds_label(f.bedrooms)} sale"
                   f"{'s' if result.count != 1 else ''} in {html.escape(b['name'])} in the last 12 months. "
                   f"I need at least {settings.min_sales} to compare fairly. Tap “Alert me” and I'll message you "
                   "when the next one registers.")
    buttons = InlineKeyboardMarkup([
        [InlineKeyboardButton("What would this cost per month?", callback_data=f"m:{check['id']}:20")],
        [InlineKeyboardButton("Alert me on new sales", callback_data=f"a:{check['id']}")],
    ])
    await q.message.reply_photo(card, caption=caption + demo_note(), parse_mode=ParseMode.HTML, reply_markup=buttons)


# ---------- monthly cost and consent ----------

async def on_monthly(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    q = update.callback_query
    await q.answer()
    _, check_id, down = q.data.split(":")
    check = db.get_check(conn, int(check_id))
    if not check or check["tg_id"] != update.effective_user.id:
        return
    e = estimate(check["price_aed"], int(down), settings.mortgage_rate_pct, settings.mortgage_years)
    text = (f"<b>Monthly cost estimate</b> for {fmt_aed(check['price_aed'])}\n\n"
            f"Down payment {e.down_pct}%: {fmt_aed(e.price * e.down_pct / 100)}\n"
            f"Loan: {fmt_aed(e.loan)} over {e.years} years at {e.rate_pct}%\n"
            f"<b>Monthly payment: about {fmt_aed(e.monthly)}</b>\n"
            f"Cash needed upfront: about {fmt_aed(e.upfront)}\n\n"
            "<i>Estimate only, not an offer of credit. Upfront cash adds the 4% transfer fee, 0.25% mortgage "
            "registration, and 2% agency fee plus VAT. Your real rate depends on the bank.</i>")
    rows = [[InlineKeyboardButton(f"{'• ' if d == e.down_pct else ''}{d}% down", callback_data=f"m:{check_id}:{d}")
             for d in DOWN_OPTIONS],
            [InlineKeyboardButton("Talk to a mortgage adviser", callback_data=f"c:{check_id}")]]
    markup = InlineKeyboardMarkup(rows)
    if q.message.photo:  # first tap comes from the card: send a new message
        await q.message.reply_text(text, parse_mode=ParseMode.HTML, reply_markup=markup)
    else:
        await q.edit_message_text(text, parse_mode=ParseMode.HTML, reply_markup=markup)


async def on_consent_ask(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    q = update.callback_query
    await q.answer()
    check_id = int(q.data.split(":")[1])
    context.user_data["consent_check"] = check_id
    context.user_data["awaiting"] = "contact"
    keyboard = ReplyKeyboardMarkup(
        [[KeyboardButton("Share my phone number", request_contact=True)], [KeyboardButton("No thanks")]],
        one_time_keyboard=True, resize_keyboard=True,
    )
    await q.message.reply_text(
        f"If you share your phone number, I'll pass it with this listing to <b>{html.escape(settings.partner_name)}"
        "</b>, a licensed mortgage broker, so an adviser can contact you about financing. "
        "I share it with nobody else. You can withdraw at any time with /delete.\n\n"
        "Nothing is shared unless you tap “Share my phone number”.",
        parse_mode=ParseMode.HTML, reply_markup=keyboard,
    )


async def on_contact(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    msg = update.message
    check_id = context.user_data.pop("consent_check", None)
    context.user_data["awaiting"] = None
    if check_id is None:
        await msg.reply_text("Thanks. Tap “Talk to a mortgage adviser” under a listing first.",
                             reply_markup=ReplyKeyboardRemove())
        return
    if msg.contact.user_id != update.effective_user.id:
        await msg.reply_text("Please share your own number using the button.", reply_markup=ReplyKeyboardRemove())
        return
    check = db.get_check(conn, check_id)
    consent_id = db.record_consent(conn, update.effective_user.id, check_id, settings.partner_name,
                                   CONSENT_VERSION, msg.contact.phone_number)
    if settings.partner_chat_id and check:
        b = db.building(conn, check["building_id"])
        e = estimate(check["price_aed"], 20, settings.mortgage_rate_pct, settings.mortgage_years)
        await context.bot.send_message(
            settings.partner_chat_id,
            f"New lead (consent {CONSENT_VERSION}, ref {check['code']})\n"
            f"Name: {msg.contact.first_name} {msg.contact.last_name or ''}\nPhone: {msg.contact.phone_number}\n"
            f"Looking at: {b['name']}, {beds_label(check['beds'])}, {check['size_sqft']:,.0f} sq ft, "
            f"{fmt_aed(check['price_aed'])}\nLoan at 20% down: about {fmt_aed(e.loan)}",
        )
        db.mark_lead_sent(conn, consent_id)
    await msg.reply_text(
        f"Done. {settings.partner_name} will contact you. Send /delete at any time to withdraw.",
        reply_markup=ReplyKeyboardRemove(),
    )


async def on_no_thanks(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    context.user_data.pop("consent_check", None)
    context.user_data["awaiting"] = None
    await update.message.reply_text("No problem. Nothing was shared.", reply_markup=ReplyKeyboardRemove())


# ---------- alerts ----------

async def on_alert(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    q = update.callback_query
    check = db.get_check(conn, int(q.data.split(":")[1]))
    if not check or check["tg_id"] != update.effective_user.id:
        await q.answer()
        return
    db.add_watch(conn, check["id"], check["tg_id"], check["sales_count"])
    await q.answer("Alert on. I'll message you when a new sale registers.", show_alert=True)


async def run_alerts(context: ContextTypes.DEFAULT_TYPE) -> None:
    for w in db.list_watches(conn):
        sales = db.recent_sales(conn, w["building_id"], w["beds"])
        if len(sales) <= w["last_count"]:
            continue
        result = analyse(w["price_aed"], w["size_sqft"], sales)
        b = db.building(conn, w["building_id"])
        newest = sales[0]
        verdict = (f"Your saved listing at {fmt_aed(w['price_aed'])} is now <b>{fmt_pct(result.diff)}</b> against the "
                   f"median of {result.count} sales." if result.enough else
                   f"Still only {result.count} sales, not enough for a verdict.")
        try:
            await context.bot.send_message(
                w["tg_id"],
                f"New {beds_label(w['beds'])} sale registered in {html.escape(b['name'])}: "
                f"{fmt_aed(newest['price_aed'] / newest['size_sqft'])} per sq ft.\n{verdict}\n\n"
                "Send the screenshot again for a fresh stamp." + demo_note(),
                parse_mode=ParseMode.HTML,
            )
            db.update_watch_count(conn, w["check_id"], len(sales))
        except Exception as e:  # user blocked the bot, etc.
            log.warning("Alert to %s failed: %s", w["tg_id"], e)


async def on_error(update: object, context: ContextTypes.DEFAULT_TYPE) -> None:
    log.exception("Unhandled error", exc_info=context.error)
    if isinstance(update, Update) and update.effective_message:
        await update.effective_message.reply_text("Something went wrong on my side. Please send it again.")


def build_app() -> Application:
    global extractor
    if not settings.telegram_token:
        raise SystemExit("Set TELEGRAM_BOT_TOKEN in .env (get one from @BotFather).")
    db.init(conn)
    added = seed_demo.seed(conn)
    if added:
        log.info("Loaded %d demo sales", added)
    extractor = Extractor()

    app = Application.builder().token(settings.telegram_token).build()
    app.add_handler(CommandHandler("start", start))
    app.add_handler(CommandHandler("help", start))
    app.add_handler(CommandHandler("privacy", privacy))
    app.add_handler(CommandHandler("delete", delete))
    app.add_handler(CommandHandler("saved", saved))
    app.add_handler(CommandHandler("stopalerts", stop_alerts))
    app.add_handler(CommandHandler("stats", stats))
    app.add_handler(CallbackQueryHandler(on_building_chosen, pattern=r"^b:"))
    app.add_handler(CallbackQueryHandler(on_monthly, pattern=r"^m:\d+:\d+$"))
    app.add_handler(CallbackQueryHandler(on_consent_ask, pattern=r"^c:\d+$"))
    app.add_handler(CallbackQueryHandler(on_alert, pattern=r"^a:\d+$"))
    app.add_handler(MessageHandler(filters.CONTACT, on_contact))
    app.add_handler(MessageHandler(filters.Regex(r"^No thanks$"), on_no_thanks))
    app.add_handler(MessageHandler(filters.PHOTO | filters.Document.IMAGE | (filters.TEXT & ~filters.COMMAND),
                                   on_listing))
    app.add_error_handler(on_error)
    app.job_queue.run_daily(run_alerts, time=dt.time(hour=settings.alert_hour_utc, tzinfo=dt.timezone.utc))
    return app


def main() -> None:
    logging.basicConfig(format="%(asctime)s %(levelname)s %(name)s: %(message)s", level=logging.INFO)
    logging.getLogger("httpx").setLevel(logging.WARNING)
    build_app().run_polling(allowed_updates=Update.ALL_TYPES)
