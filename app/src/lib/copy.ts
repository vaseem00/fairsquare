/**
 * The DESIGN.md section 6 copy deck, keyed exactly as DESIGN.md names the keys, plus the
 * server-only error text (A§4.1, `apiError.{code}`) and the builders shared by the UI, the stamp,
 * the canvas card, the OG image and the share text (A§2.10). Client-safe: no server imports.
 *
 * Conventions:
 * - Placeholders are `{name}` and are filled by `t(key, vars)`. A missing placeholder throws.
 *   Placeholder names are DESIGN.md's, including `{sale/sales}`, `{above/below}`, `{PARTNER_NAME}`.
 * - A value listing alternatives with " / " (for example `theme.options`) is read with `tList(key)`.
 * - `saved.newSales` is "singular / plural": use `tPlural("saved.newSales", n)`.
 * - Keys marked "(added)" are not in DESIGN.md section 6; they hold strings DESIGN.md uses
 *   elsewhere (sections 3, 5.3, 8) or variants the deck describes in a note.
 */
import { shownAcs, type ShownAcs } from "@/lib/acs/shown";
import { sizeDifference } from "@/lib/domain/analyse";
import { addDays, type IsoDate } from "@/lib/domain/dates";
import { codeSeed } from "@/lib/domain/share-code";
import { bedsLabel, bedsLabelPlural, formatDate, formatInt, formatPct, formatPctNumber, slugify } from "@/lib/format";
import { shownNearby, type ShownNearby } from "@/lib/nearby/shown";
import { recentSet, type RecentSet } from "@/lib/result/scale-model";
import { shownSimilar, similarReadsOthers } from "@/lib/similar/shown";
import type { CheckView, ErrorCode, ExtractOutcome, NearbyView, RateLimitScope, SaleView, SimilarView } from "@/lib/types";

export const COPY = {
  // ---------- 6.1 Shell ----------
  "nav.compare": "Compare",
  "nav.saved": "Saved",
  "nav.savedSr": "Saved, {n} listings have new sales",
  "nav.coverage": "Coverage",
  "nav.how": "How Fairsquare compares",
  "nav.privacy": "Privacy",
  "nav.menu": "Menu",
  "nav.skip": "Skip to content",
  "theme.label": "Theme",
  "theme.options": "Light / Dark / System",
  "footer.notValuation":
    "Fairsquare compares asking prices with registered sales. It is not a valuation and not financial advice.",
  "footer.ai": "Fairsquare uses Claude, Anthropic's AI, to read screenshots.",
  /** (added) Product name, page titles. */
  "app.name": "Fairsquare",
  /** (added) Default meta description. */
  "app.description": "Compare a Dubai listing's asking price with recent sales in the same building.",
  /** (added) Brand link name, DESIGN.md section 2.8. */
  "nav.home": "Fairsquare home",
  /** (added) First menu-sheet item, DESIGN.md section 3.0. */
  "nav.compareLong": "Compare a listing",
  /** (added) Close button of drawers, sheets and dialogs. */
  "ui.close": "Close",

  // ---------- 6.2 Home and step 1 ----------
  "home.h1": "Weigh the asking price.",
  "home.lead":
    "Add a screenshot of a Dubai apartment listing. Fairsquare compares its price per sq ft with registered sales in the same building.",
  "home.choose": "Add a screenshot",
  "home.dropActive": "Drop the screenshot to read it",
  "home.paste": "Paste listing text",
  "home.pasteLabel": "Listing text",
  /** The format of listing text, with no building, agent or price that could pass for a real listing. */
  "home.pastePlaceholder": "Building name, 2BR, 1284 sqft, AED 2.45M",
  "home.pasteRead": "Read text",
  "home.type": "Type the details",
  "home.privacy": "Fairsquare uses Claude, Anthropic's AI, to read your screenshot. It isn't stored.",
  "home.privacyLink": "Privacy",
  /**
   * (added, REAL_DATA.md section 10) "From the data", beside the tool on the home page. Real numbers
   * from the loaded sales only, never a listing or an asking price.
   */
  "home.dataH2": "From the data",
  "home.dataLink": "See all buildings Fairsquare covers",

  // ---------- 6.3 Reading ----------
  "step.back": "Back",
  "read.reading": "Reading the listing",
  "read.matching": "Finding the building",
  /** `{s}`: the median read time of the last 200 reads in whole seconds (RESULT_SPEC section 2.3). */
  "read.slow": "Still reading. This usually takes about {s} seconds.",
  /** `read.slow` until 50 reads exist (`readSlowText`). */
  "read.slowFallback": "Still reading. This can take up to 20 seconds.",
  "read.stop": "Stop",
  "read.stopped": "Reading stopped. Your screenshot is still here.",
  /** (added) Stop on pasted text: the text stays in the box on home. */
  "read.stoppedText": "Reading stopped. Your text is still here.",
  "read.typeInstead": "Type the details instead",
  "read.thumb": "Your screenshot",
  "read.replace": "Replace",
  "read.remove": "Remove screenshot",
  "read.view": "View screenshot larger",

  // ---------- 6.4 Details and building ----------
  "details.h2": "Check the details",
  "details.source.claude": "From your screenshot",
  "details.source.manual": "Added by you",
  "details.source.changed": "Changed by you",
  "details.missing": "Not in the screenshot. Add it here.",
  "details.missingBeds": "Not in the screenshot. Choose one.",
  "field.building": "Building",
  "field.area": "Area",
  "field.bedrooms": "Bedrooms",
  "field.bedroomsOptions": "Studio / 1 bed / 2 bed / 3 bed / 4 bed / 5 bed / 6 bed / 7 or more",
  "field.size": "Size (sq ft)",
  "field.price": "Asking price (AED)",
  /** (added, REAL_DATA.md section 7) Step 2: which sales the listing is compared with. */
  "field.offPlan": "Off-plan (not finished yet)",
  "field.offPlanHelp": "Off-plan listings are compared with off-plan sales only, all others with ready ones.",
  "err.bedrooms": "Choose the number of bedrooms.",
  "err.size": "Enter the size in sq ft, for example 1,284.",
  "err.price": "Enter the asking price in AED, for example 2,450,000.",
  "err.psf": "That works out to AED {psf} per sq ft, which looks wrong. Check the size and price.",
  "err.building": "Enter the building name as the listing shows it.",
  "err.pick": "Choose a building, or choose None of these.",
  "err.summary": "Fix {n} things to compare the price",
  /** (added) Date fields (admin sales, CSV). */
  "err.date": "Enter a date like 2026-11-17.",
  "pick.legend": "Which building is it?",
  "pick.best": "Best match",
  "pick.coverage": "{n} {basis} {bedWord} sales in {months} months",
  /** "singular / plural" (read with `tPlural`): below MIN_SALES the option says it can't be compared. */
  "pick.coverageThin":
    "Only {n} {basis} {bedWord} sale in {months} months: Fairsquare needs {minSales} to compare / Only {n} {basis} {bedWord} sales in {months} months: Fairsquare needs {minSales} to compare",
  /** (added, real data) `pick.coverageThin` for no sales at all. */
  "pick.coverageZero": "No {basis} {bedWord} sales in {months} months: Fairsquare needs {minSales} to compare",
  "pick.lookalike": "Two towers have similar names. Check the tower number on the listing.",
  /** (added, real data) DLD names repeat across areas: two options with the same name. */
  "pick.sameName": "Two buildings have this name in different areas. Check the area on the listing.",
  "pick.none": "None of these",
  "pick.noneSub": "You can ask Fairsquare to add “{text}” next.",
  "pick.search": "Search covered buildings",
  "pick.searchPlaceholder": "Building name",
  /** "singular / plural" (read with `tPlural`). */
  "pick.announce": "{n} matching building / {n} matching buildings",
  /** (added) Announced after choosing in "Search covered buildings" (the dialog closes on choice). */
  "pick.searchChosen": "{building} chosen.",
  "details.cta": "Compare price",
  "details.ctaBusy": "Comparing...",
  "alert.rentalContinue": "It's for sale, continue",
  "alert.anyway": "Type the details anyway",
  "alert.tryAnother": "Try another screenshot",
  "alert.tryAgain": "Try again",
  /** (added, WP6) The paste shortcut, "{keys}" in `home.pasteKeys` ("Ctrl V", "Cmd V" on Apple keyboards). */
  "home.kbdCtrl": "Ctrl",
  "home.kbdCmd": "Cmd",
  "home.kbdV": "V",
  /** (added, WP6) Announced when a screenshot is chosen, DESIGN.md section 7.2. */
  "read.announce": "Reading your screenshot",
  /** (added, WP6) Source line for values read from pasted listing text. */
  "details.source.text": "From the listing text",
  /** (added, WP6) Bedrooms Select placeholder, and the AED / sq ft input addons (DESIGN.md section 3.3). */
  "field.bedroomsPlaceholder": "Choose",
  "field.aed": "AED",
  "field.sqft": "sq ft",
  /** (added, WP6) Building options empty states, DESIGN.md section 5.2. */
  "pick.typeToMatch": "Type the building name to see matches.",
  "pick.noMatch": "No covered building matches this name.",
  /** (added, WP6) `{bedWord}` in `pick.coverage` / `pick.coverageThin`, by bedrooms 0–7 (read with `tList`). */
  "pick.bedWords": "studio / one-bed / two-bed / three-bed / four-bed / five-bed / six-bed / seven-bed",

  // ---------- 6.5 Result ----------
  "band.above": "Above recent sales",
  "band.inline": "In line with recent sales",
  "band.below": "Below recent sales",
  "band.thin": "Not enough sales",
  "band.none": "Not covered yet",
  "result.sentenceAbove":
    "This listing asks AED {asking} per sq ft, {pct}% above the median of {count} {salesAdj} sales of {basis} {bedType} apartments in {building} (AED {median} per sq ft).",
  "result.sentenceBelow":
    "This listing asks AED {asking} per sq ft, {pct}% below the median of {count} {salesAdj} sales of {basis} {bedType} apartments in {building} (AED {median} per sq ft).",
  "result.sentenceInline":
    "This listing asks AED {asking} per sq ft, within {bandPct}% of the median of {count} {salesAdj} sales of {basis} {bedType} apartments in {building} (AED {median} per sq ft).",
  /** The provenance after the attribution (`data.attribution`): real dates and the completion basis. */
  "result.source.live": "Sales from {from} to {to}, same building, {basis} {bedType} apartments, per sq ft.",
  /** (added, REAL_DATA.md section 7) `{basis}`: which sales a listing is compared with. */
  "result.basis.ready": "ready",
  "result.basis.off_plan": "off-plan",
  /** (added, REAL_DATA.md section 7) Outliers left out ("singular / plural", read with `tPlural`). */
  "result.outliers": "{n} unusual sale left out / {n} unusual sales left out",
  /**
   * (added, REAL_DATA.md section 9) Sales the admin registered or imported are not DLD open data:
   * the row mark, and the provenance line when some or all of the compared sales are such sales.
   */
  "result.addedByUs": "Added by Fairsquare",
  "result.addedSome":
    "{n} of these sales was added by Fairsquare, not taken from the DLD open data. / {n} of these sales were added by Fairsquare, not taken from the DLD open data.",
  "result.addedAll": "These sales were added by Fairsquare, not taken from the DLD open data.",
  /** (added) The sales list when a comparison used more sales than it stores (SNAPSHOT_MAX). */
  "result.salesShown": "Showing the newest {shown} of {count} sales.",
  /** (added, REAL_DATA.md section 7) The size check, when the listing differs from the median sale size by more than 20%. */
  "result.sizeLarger":
    "This listing is {pct}% larger than the typical sale here. DLD sizes may be measured differently, for example with or without balconies.",
  "result.sizeSmaller":
    "This listing is {pct}% smaller than the typical sale here. DLD sizes may be measured differently, for example with or without balconies.",
  "result.howTrigger": "How Fairsquare compares",
  /** `{to}`: the comparison's window end, min(the day it was made, data_through) (REAL_DATA.md section 7). */
  "result.howBody":
    "Fairsquare takes the median price per sq ft of same-bedroom sales in this building over the {months} months to {to}. Within {bandPct}% either way counts as in line. With fewer than {minSales} sales it doesn't compare.",
  "result.howLink": "Read how Fairsquare compares",
  "result.another": "Compare another listing",
  "result.editDetails": "Edit details",
  /** (added) Sales table column headers (DESIGN.md section 3.4). */
  "result.colDate": "Registered on",
  "result.colSize": "Size (sq ft)",
  "result.colPrice": "Price (AED)",
  "result.colPsf": "AED per sq ft",
  /** (added) Sales list row parts (DESIGN.md section 3.4). */
  "result.rowPsf": "AED {psf} per sq ft",
  "thin.h2": "Too few sales to compare yet",
  "thin.body":
    "Only {count} {salesAdj} {sale/sales} of {basis} {bedType} apartments in {building} in the {months} months to {to}. Fairsquare needs at least {minSales} to compare.",
  /** (added) `thin.body` when the count is 0 (the deck's note). */
  "thin.bodyZero":
    "No {salesAdj} sales of {basis} {bedType} apartments in {building} in the {months} months to {to}. Fairsquare needs at least {minSales} to compare.",
  "thin.progress": "{count} of the {minSales} sales needed",
  "none.h2": "We don't cover {building} yet",
  "none.body": "Fairsquare covers {n} buildings. Request this one and track it under Saved.",
  "none.cta": "Request it and track",
  "none.ctaDone": "Requested",
  "none.done": "Requested. It shows under Saved. {n} other people asked for it too.",
  /** (added) `none.done` when no one else asked (the deck's note: drop the second sentence). */
  "none.doneAlone": "Requested. It shows under Saved.",
  "offplan.notice": "Compared with off-plan sales only. Payment plans can explain a different price.",
  /** (added, REAL_DATA.md section 7) Shown on every result, the home page and /c when the data is more than 45 days old. */
  "data.stale": "Fairsquare's sales data currently runs to {date}. Sales registered after that aren't included yet.",
  /** (added, REAL_DATA.md section 7) No sales data loaded yet. */
  "data.loading": "Sales data is being loaded. Try again in a few minutes.",
  /** (added, REAL_DATA.md section 10) Under the "From the data" panel. */
  "data.runsTo": "Sales data runs to {date}.",
  /**
   * (added, REAL_DATA.md section 9) The attribution on results, /c, How it works and the footer.
   * `{dataset}` and `{licence}` are `data.dataset` and `data.licence`, linked to the manifest's
   * datasetUrl and licenceUrl.
   */
  "data.attribution": "Source: {dataset}, published as open data on Data.Dubai and used under the {licence}.",
  "data.dataset": "Dubai Land Department sales transactions",
  "data.licence": "Dubai Open Data Licence",
  /** (added, REAL_DATA.md section 9) Footer and How it works. */
  "data.independent":
    "Fairsquare is independent. It is not affiliated with or endorsed by the Dubai Land Department or the Government of Dubai.",
  /** (added, REAL_DATA.md section 6) The shown area with the official DLD area name, where space allows. */
  "area.withDld": "{area} (DLD area: {areaDld})",
  /** (added, REAL_DATA.md section 6) In the provenance of a result and /c: `{area}` is `areaLabel()`. */
  "result.building": "Building: {building}, {area}.",

  // ---------- 6.6 Share and save ----------
  "share.cta": "Share",
  "share.whatsapp": "Send on WhatsApp",
  "share.download": "Download card",
  "share.copy": "Copy link",
  "share.copied": "Link copied",
  "share.downloaded": "Card downloaded",
  /**
   * The WhatsApp text (RESULT_SPEC section 8.2), built by `shareText`: the head (share.text above or
   * below, share.textInline, share.textThin), then share.recent when the recent-sales line shows, then
   * share.source with the link. `{building}` is the listing's own text; `{listingType}` is "ready
   * 2-bed" or "off-plan 2-bed" as the listing says, or "2-bed" when it didn't say; `{size}` reads
   * "about 815" after a size button.
   */
  "share.text":
    "{building}, {listingType}, {size} sq ft, asking AED {price} (AED {asking} per sq ft), {pct}% {above/below} the median of {count} registered {bedType} sales in this tower, {months} months to {to}: AED {median} per sq ft.",
  "share.textInline":
    "{building}, {listingType}, {size} sq ft, asking AED {price} (AED {asking} per sq ft). Median of {count} registered {bedType} sales in this tower, {months} months to {to}: AED {median} per sq ft.",
  "share.textThin":
    "{building}, {listingType}, {size} sq ft, asking AED {price}: only {count} registered {bedType} {sale/sales} in this tower in {months} months, too few to compare.",
  /** `share.textThin` with no sales at all. */
  "share.textThinZero":
    "{building}, {listingType}, {size} sq ft, asking AED {price}: no registered {bedType} sales in this tower in {months} months, too few to compare.",
  "share.recent": "Last 90 days: AED {median} per sq ft ({count} sales).",
  "share.source": "Source: DLD open data via Data.Dubai. Not a valuation. {url}",
  /** (added) Share text for a not-covered comparison. */
  "share.textNone": "{building} {bedType} at AED {price}: Fairsquare doesn't cover this building yet. See it on Fairsquare: {url}",
  "share.fileName": "fairsquare-{building-slug}-{code}.png",
  "save.cta": "Save and track",
  "save.done": "Tracking",
  "save.announce": "Saved. New sales in {building} will show under Saved.",
  "save.helper": "New sales in this building show up under Saved. Fairsquare doesn't send messages yet.",

  // ---------- 6.7 Monthly cost ----------
  "cost.row": "About AED {monthly} a month with {down}% down",
  "cost.adjust": "Adjust",
  "cost.title": "Monthly cost estimate",
  "cost.for": "For an asking price of AED {price}",
  "cost.monthly": "About AED {monthly} a month",
  "cost.announce": "Monthly payment about AED {monthly}",
  "cost.loan": "Loan",
  "cost.upfront": "Cash upfront, about",
  "cost.breakdown": "Show the upfront costs",
  "cost.down": "Down payment",
  "cost.downValue": "{down}% (AED {amount})",
  "cost.downSr": "{down} percent, AED {amount}",
  "cost.dld": "DLD transfer fee (4%)",
  "cost.reg": "Mortgage registration (0.25%)",
  "cost.agency": "Agency fee (2% plus VAT)",
  "cost.rate": "Interest rate (%)",
  "cost.rateHelp": "Assumed rate. Check with your bank.",
  "cost.rateErr": "Enter a rate between 1% and 12%.",
  "cost.term": "Term",
  "cost.termOptions": "15 years / 20 years / 25 years",
  "cost.disclosure":
    "Estimate only, not an offer of credit. Expats usually need at least 20% down on a first home up to AED 5M, and 30% above that.",
  /** (added) Down payment step buttons (DESIGN.md section 3.4). */
  "cost.downLess": "Less down payment",
  "cost.downMore": "More down payment",

  // ---------- 6.8 Adviser and consent ----------
  "lead.h3": "Talk to a mortgage adviser",
  "lead.partnerLive": "Licensed by {PARTNER_REGULATOR}, licence {PARTNER_LICENCE}.",
  "lead.promiseLive": "{PARTNER_PROMISE}",
  /** (added, REAL_DATA.md section 8) The money panel without a configured partner; also `leads_unavailable`. */
  "lead.unavailable": "Talking to a mortgage adviser through Fairsquare isn't available yet.",
  "consent.v1":
    "Share my name, phone number and this listing with {PARTNER_NAME}, a licensed mortgage broker, so an adviser can contact me about financing. I can withdraw this at any time.",
  "lead.name": "Your name",
  "lead.mobile": "UAE mobile",
  "lead.mobileHelp": "For example +971 50 123 4567",
  "lead.send": "Send my details to {PARTNER_NAME}",
  "lead.sending": "Sending...",
  "lead.nothingShared": "Nothing is shared unless you tick the box and press send.",
  "lead.errName": "Enter your name.",
  "lead.errMobile": "Enter a UAE mobile number, for example +971 50 123 4567.",
  "lead.errSend": "Couldn't send your details. Nothing was shared. Try again.",
  /** (added, integration) Server-side check: the down payment is below the minimum for this price. */
  "lead.errDown": "For this price the down payment starts at {pct}%.",
  "lead.sentTitle": "Sent to {PARTNER_NAME}",
  "lead.sentName": "Name: {name}",
  "lead.sentMobile": "Mobile ending {last4}",
  "lead.sentListing": "Listing: {building}, {bedType}, AED {price}",
  "lead.sentAt": "Sent {date} at {time}",
  "lead.withdraw": "Withdraw this request",

  // ---------- 6.9 Saved, data and confirmations ----------
  "saved.h1": "Saved",
  "saved.intro": "Saved on this browser. New sales in these buildings show here. Fairsquare doesn't send messages yet.",
  "saved.listingsH2": "Listings",
  /** (added) Saved item detail line, DESIGN.md section 3.6. */
  "saved.itemDetail": "{bedType}, AED {price}",
  "saved.newSales": "{n} new sale / {n} new sales",
  "saved.then": "Saved {date}: {figure} vs {count} sales.",
  "saved.thenThin": "Saved {date}: too few sales to compare.",
  "saved.now": "Today: {figure} vs {count} sales.",
  "saved.open": "Open",
  "saved.more": "More actions for {building}",
  "saved.remove": "Remove",
  "saved.removed": "Removed {building}.",
  "saved.undo": "Undo",
  "saved.requestsH2": "Buildings you asked for",
  "saved.requestLine": "Requested {date}. {n} other people asked.",
  "saved.nowCovered": "Now covered. Compare again.",
  "saved.adviserH2": "Adviser request",
  "saved.adviserLine": "Sent to {PARTNER_NAME} on {date}.",
  "saved.adviserWithdrawn": "Withdrawn on {date}. {PARTNER_NAME} will be told to delete your details.",
  "saved.dataH2": "Your data",
  "saved.recoveryIntro": "Your list lives on this browser. To keep it on another browser, copy your recovery link.",
  "saved.recoveryCta": "Copy recovery link",
  "saved.recoveryDone": "Recovery link copied. Anyone with this link can see your saved list.",
  /** (added) /saved?recovery=failed. */
  "saved.recoveryFailed": "That recovery link didn't work. It may be mistyped or more than 30 days old.",
  /** (added) /saved?recovery=confirm: a recovery link opened on a browser that already has a list. */
  "saved.recoveryConfirm":
    "This link opens a different saved list. Replace the list on this browser with it? Your current list stays on this browser only if you keep it.",
  "saved.recoveryReplace": "Replace with the linked list",
  "saved.recoveryKeep": "Keep this browser's list",
  "saved.deleteCta": "Delete all my data",
  /** (added) "Your data" list of what is stored (BUILD_PLAN WP8). */
  "saved.dataChecks": "Comparisons",
  "saved.dataSaved": "Saved listings",
  "saved.dataRequests": "Building requests",
  "saved.dataLeads": "Adviser requests",
  "saved.emptyH": "Nothing saved yet",
  "saved.emptyBody": "Save a comparison to see new sales in that building here.",
  "saved.emptyCta": "Compare a listing",
  "confirm.withdraw.title": "Withdraw your request?",
  "confirm.withdraw.body": "{PARTNER_NAME} will be told to delete your details.",
  "confirm.withdraw.yes": "Withdraw request",
  "confirm.withdraw.no": "Keep it",
  "confirm.withdraw.done": "Request withdrawn",
  "confirm.delete.title": "Delete everything Fairsquare stores for this browser?",
  "confirm.delete.body":
    "This deletes your saved listings and comparisons, unlinks your building requests from this browser, and removes your name and mobile from any adviser request. If you sent your details to {PARTNER_NAME}, they will be told to delete them. Links to your comparisons will stop working. You can't undo this.",
  /** (added, REAL_DATA.md section 8) `confirm.delete.body` with no partner and no adviser request. */
  "confirm.delete.bodyNoPartner":
    "This deletes your saved listings and comparisons and unlinks your building requests from this browser. Links to your comparisons will stop working. You can't undo this.",
  "confirm.delete.yes": "Delete everything",
  "confirm.delete.no": "Keep my data",
  "confirm.delete.done": "Your data is deleted.",

  // ---------- 6.10 Coverage and How Fairsquare compares ----------
  "coverage.h1": "Buildings Fairsquare covers",
  "coverage.intro":
    "Fairsquare compares a listing when the building has at least 5 registered sales of that apartment type with the same completion (ready, or off-plan for an off-plan listing) in the last 12 months of the data, not counting unusual sales.",
  "coverage.search": "Search buildings",
  /** "singular / plural" (read with `tPlural`). */
  "coverage.matches": "{n} building matches / {n} buildings match",
  "coverage.latest": "{area}. Latest sale {date}.",
  /** Ready and off-plan sales are never pooled (REAL_DATA.md section 7). */
  "coverage.typeLine": "{bedType}: {ready} ready, {offPlan} off-plan",
  /** Which listings of the type get a verdict (MIN_SALES sales of that completion, unusual ones left out). */
  "coverage.enoughBoth": "Enough ready and off-plan sales",
  "coverage.enoughReady": "Enough ready sales",
  "coverage.enoughOffPlan": "Enough off-plan sales",
  "coverage.thin": "Too few sales",
  "coverage.noMatch": 'No covered building matches "{q}".',
  "coverage.requestQ": 'Request "{q}"',
  "coverage.requestH2": "Don’t see your building?",
  "coverage.requestLabel": "Building name and area",
  "coverage.requestCta": "Request this building",
  "coverage.requestDone": "Requested. It shows under Saved.",
  "coverage.requestErr": "Type a building name.",
  /** (added) Coverage table headers and empty states, DESIGN.md sections 3.7 and 5.2. */
  "coverage.colTypes": "Apartment types",
  "coverage.colLatest": "Latest sale",
  "coverage.colStatus": "Status",
  "coverage.latestNone": "{area}. No sales in the last 12 months.",
  "coverage.noMatchBody": "You can ask Fairsquare to add it.",
  /** (added, REAL_DATA.md section 11) Server-side search and pages of 50 at real scale. */
  "coverage.window": "Counts are registered sales from {from} to {to}, most sales first.",
  "coverage.searchHelp": "A building or area name, at least 2 letters.",
  "coverage.counts": "{ready} ready and {offPlan} off-plan sales",
  "coverage.colReady": "Ready sales",
  "coverage.colOffPlan": "Off-plan sales",
  /** "singular / plural" by the total (read with `tPlural`). */
  "coverage.showing": "Showing {first} to {last} of {total} building / Showing {first} to {last} of {total} buildings",
  "coverage.pages": "Pages",
  "coverage.prev": "Previous page",
  "coverage.next": "Next page",
  "coverage.loadFailed": "Couldn't load the buildings just now. Try again.",
  "how.h1": "How Fairsquare compares",
  "how.intro":
    "Fairsquare compares an asking price with recent sales of the same apartment type in the same building. It is not a valuation.",
  "how.whatH2": "What Fairsquare compares",
  "how.what":
    "Fairsquare divides the asking price by the size to get a price per sq ft. It compares that with the median price per sq ft of sales in the same building with the same number of bedrooms. Comparing per sq ft evens out small size differences.",
  "how.rulesH2": "The rules",
  "how.rules":
    "Same building. / Same number of bedrooms (a studio counts as 0). / Sales in the last 12 months of the data. / At least 5 sales, or Fairsquare doesn't compare. / The median, so one unusual sale can't move the result much. / Within 5% of the median counts as in line. More than 5% is above or below.",
  "how.outH2": "What it leaves out",
  "how.out":
    "Floor, view, condition, parking, furnishing and off-plan payment plans. Any of these can justify a different price.",
  "how.dataH2": "Where the data comes from",
  "how.dataLive": "The sales Fairsquare uses run from {from} to {to}. Fairsquare last loaded them on {date}.",
  /** (added, REAL_DATA.md sections 2, 7 and 9) The `#data` section: what is in the data and what is not. */
  "how.dataIncluded":
    "Included: sales registered with the Dubai Land Department of apartments for living in, from studios to 7 bedrooms, ready and off-plan. / Left out: mortgages, gifts, leases, land, villas, offices, shops, penthouses and single rooms. / Left out: deals that sold several apartments at once, and 3 or more sales at the same price in one building on one day. / Left out: sales with no building name, and sizes or prices per sq ft far outside the usual range.",
  "how.dataBasis":
    "Ready and off-plan sales are compared separately. A listing marked off-plan is compared only with off-plan sales; every other listing with ready ones.",
  "how.dataDifc": "Buildings in DIFC aren't in this data: DIFC registers its own property sales, not the Dubai Land Department.",
  "how.dataSizes":
    "Sizes are the registered sizes. They may be measured differently from a listing, for example with or without balconies, so Fairsquare points out a listing that is more than 20% larger or smaller than the typical sale.",
  "how.dataRefresh":
    "Fairsquare updates the sales by hand from the latest file on Data.Dubai, about once a month. Sales registered after the last date above aren't included yet.",
  "how.readH2": "Who reads your screenshot",
  "how.read":
    "Claude, an AI model made by Anthropic, reads the building, bedrooms, size and price. Fairsquare doesn't store the screenshot. You can check and change every value before comparing.",
  "how.valuationH2": "Not a valuation",
  "how.valuation":
    "A comparison with past sales is not a valuation. For a valuation, ask a RERA-certified valuer.",
  /** (added, WP7) The table of contents, DESIGN.md section 3.9. */
  "how.tocLabel": "On this page",
  /** (added, WP7) The rules `dl` (DESIGN.md section 3.9), filled from `config.rules`. */
  "how.ruleTerms":
    "Same building / Same apartment type / Last {months} months / At least {minSales} sales / Median price per sq ft / Within {bandPct}% is in line",
  /**
   * (added, WP7) The `dd` beside each `how.ruleTerms` term, with the numbers from `config.rules`. Each
   * one explains its term instead of repeating it (the deck's `how.rules` reads as one list).
   */
  "how.ruleDetails":
    "Only sales in the same tower, not the whole area, and off-plan listings only with off-plan sales. / Same number of bedrooms; a studio counts as 0. / Sales registered in the {months} months up to the latest sale in the data. / With fewer, Fairsquare shows no verdict. / Sales under half or over twice the median per sq ft are left out, so one unusual sale can't move the result much. / More than {bandPct}% either way is above or below.",

  // ---------- 6.11 Privacy ----------
  "privacy.h1": "Privacy",
  "privacy.storesH2": "What Fairsquare stores",
  "privacy.stores":
    "An anonymous id in a cookie, so your saved list works without an account. / The numbers from each comparison: building, bedrooms, size, price and result. / Listings you save and buildings you request. / Simple usage events, such as when a comparison is shared or a cost estimate is opened, linked to the anonymous id. / Your name and mobile, only if you send them to {PARTNER_NAME}, with the consent text you agreed to and when.",
  "privacy.howLong":
    "The cookie lasts 400 days from your last visit. Comparisons, saved listings, requests and usage events stay until you delete them under Saved. A removed saved listing is erased after 30 days. If you withdraw an adviser request or delete your data, your name and mobile are erased; a record that you agreed and later withdrew is kept, without them.",
  "privacy.notH2": "What Fairsquare doesn't store",
  "privacy.not": "Your screenshots. They are sent to Claude to read and then discarded.",
  "privacy.whoH2": "Who sees your data",
  "privacy.who":
    "Anthropic processes your screenshot to read it. {PARTNER_NAME} gets your name, mobile and the listing only after you tick the box and press send. Nobody else.",
  "privacy.cookiesH2": "Cookies",
  "privacy.cookies": "One signed, anonymous id cookie. No advertising or tracking cookies.",
  "privacy.choicesH2": "Your choices",
  "privacy.choices": "Withdraw an adviser request or delete all your data at any time under Saved.",
  /** (added) Heading for the retention paragraph. */
  "privacy.howLongH2": "How long",
  /** (added) The "What Fairsquare stores" table (DESIGN.md section 3.10): one entry per `privacy.stores` row. */
  "privacy.colData": "Data",
  "privacy.colWhy": "Why",
  "privacy.why":
    "Keeps your saved list, comparisons and requests together on this browser. / Shows the result and keeps its share link working. / Shows new sales in the buildings you track and tells Fairsquare which buildings to add. / Shows Fairsquare which features people use. / So {PARTNER_NAME} can contact you about financing, and as a record of what you agreed to.",
  "privacy.keep":
    "400 days from your last visit. / Until you delete your data under Saved. / Until you delete your data under Saved. A removed saved listing is erased after 30 days. / Until you delete your data under Saved. / Until you withdraw the request or delete your data. A record that you agreed and later withdrew is kept, without your name and mobile.",
  /**
   * (added, REAL_DATA.md section 8) The page without a configured adviser partner: the table drops
   * its last row (name and mobile) and these replace the partner sentences.
   */
  "privacy.howLongNoPartner":
    "The cookie lasts 400 days from your last visit. Comparisons, saved listings, requests and usage events stay until you delete them under Saved. A removed saved listing is erased after 30 days.",
  "privacy.whoNoPartner":
    "Anthropic processes your screenshot to read it. Nobody else. Talking to a mortgage adviser through Fairsquare isn't available yet, so Fairsquare doesn't ask for your name or mobile.",
  "privacy.choicesNoPartner": "Delete all your data at any time under Saved.",

  // ---------- 6.12 Not found and errors ----------
  "notFound.h1": "This page doesn't exist",
  "notFound.body": "The link may be mistyped or out of date.",
  "notFound.cta": "Compare a listing",
  "cNotFound.h1": "This comparison link doesn't work",
  "cNotFound.body": "It may be mistyped, or the comparison was deleted.",
  "error.h1": "Something went wrong on our side",
  "error.body": "Try again. If it keeps happening, type the details by hand on the home page.",
  "error.retry": "Try again",
  "error.home": "Go to the home page",
  "claudeOff.notice": "Screenshot reading is off right now. Typing the 4 details takes about 20 seconds.",
  "outcome.notListing": "That doesn't look like a property listing. Try a screenshot that shows the price.",
  "outcome.rental": "This looks like a rental listing. Fairsquare compares sale prices only.",
  "outcome.notApartment": "This looks like a villa or townhouse. Fairsquare compares apartments only for now.",
  "error.refused": "Claude couldn't read this one. Type the details instead.",
  "error.cutShort": "The reading was cut short. Try again, or type the details.",
  "error.badImage": "That image couldn't be read. Try a JPEG or PNG screenshot.",
  "error.timeout": "Reading took too long. Try again, or type the details.",
  "error.offline": "You're offline. Connect and try again, or type the details.",
  "error.readFailed": "Reading failed. Try again, or type the details.",
  "error.compareFailed": "Couldn't compare just now. Try again.",
  "error.shareFailed": "Couldn't open sharing here. Download the card or copy the link instead.",
  "error.clipboard": "Copy didn't work here. Press and hold the link to copy it.",
  "rate.burst": "You've read a lot of screenshots in a short time. Wait {n} minutes, or type the details.",
  "rate.daily": "You've read a lot of screenshots today. Type the details, or try again tomorrow.",
  "rate.busy": "Claude is busy right now. Try again in a minute, or type the details.",
  "rate.retryIn": "Try again in {n} s",
  "rate.spam": "Too many requests from this browser. Wait a minute and try again.",
  "rate.dailyCap": "Fairsquare has read as many screenshots as it can today. Type the details instead.",
  /** (added) Server-only error text (A§4.1), `apiError.{code}`. */
  "apiError.bad_request": "That request wasn't valid. Reload the page and try again.",
  "apiError.empty_input": "Add a screenshot or paste the listing text first.",
  "apiError.validation_failed": "Some details need fixing. Check them and try again.",
  "apiError.image_too_large": "That image is too large. Try a screenshot under 8 MB.",
  "apiError.file_too_large": "That file is too large.",
  "apiError.building_not_found": 'That building isn\'t in Fairsquare\'s list any more. Pick another, or choose "None of these".',
  "apiError.consent_required": "Tick the box to agree before sending your details.",
  "apiError.consent_version_mismatch": "The consent wording changed. Read it again and tick the box.",
  "apiError.unauthorized": "Sign in to continue.",
  "apiError.bad_origin": "This request was blocked. Reload the page and try again.",
  "apiError.internal": "Something went wrong on our side. Try again.",

  // ---------- 6.13 Share page and admin ----------
  "c.date": "Compared on {date}",
  "c.h1": "{building}, {bedType}",
  "c.today": "Today: {figure} vs {count} sales.",
  /** (added, WP7) `c.today` when today's sales are too few to compare. */
  "c.todayThin": "Today: {count} {sale/sales}, too few to compare.",
  "c.cta": "Compare a listing you're looking at",
  /** No branding (RESULT_SPEC section 8.3). `{building}` is the listing's own text; `{verdictPhrase}` is a c.ogVerdict* string. */
  "c.ogTitle": "{building} {bedType}: {verdictPhrase}",
  /** (added) `c.ogTitle` variants without a verdict. */
  "c.ogTitleThin": "Too few sales to compare: {building} {bedType}",
  "c.ogTitleNone": "Not covered yet: {building} {bedType}",
  /** `{recentShort}` is "Recent sales lower. " or "Recent sales higher. " when the recent-sales line shows, else empty. */
  "c.ogDescLive": "{count} registered sales in {months} months. {recentShort}Not a valuation.",
  /** og:description for a not-covered comparison: no count, so it never reads as "0 sales". */
  "c.ogDescNone": "Not covered yet. Not a valuation.",
  "c.ogAlt": "Fairsquare comparison: asking AED {asking} per sq ft, median AED {median} of {count} registered sales.",
  /** (added) `c.ogAlt` variants without a verdict. */
  "c.ogAltThin": "Fairsquare comparison: asking AED {asking} per sq ft, {count} of the {minSales} registered sales needed to compare.",
  "c.ogAltNone": "Fairsquare: {building} {bedType} is not covered yet",
  "admin.signIn": "Sign in",
  "admin.password": "Password",
  "admin.wrong": "That password is wrong.",
  "admin.locked": "Too many tries. Wait 15 minutes.",
  "admin.signOut": "Sign out",
  "admin.registerCta": "Register sale",
  "admin.registered": "Sale registered",
  "admin.impact":
    "The {bedType} median in {building} moves from AED {old} to AED {new} per sq ft. {n} saved listings will show a new sale.",
  "admin.csvChoose": "Choose CSV file",
  "admin.csvTemplate": "Download template",
  "admin.csvDry": "{ok} rows ready. {bad} rows rejected.",
  "admin.csvImport": "Import {ok} sales",
  "admin.csvDone": "{ok} sales imported",
  "admin.deleteSale.title": "Delete this sale?",
  "admin.deleteSale.body": "It changes the comparison for everyone looking at this building.",
  "admin.deleteSale.yes": "Delete sale",
  "admin.deleteSale.no": "Keep sale",
  "admin.markCovered": "Mark as covered",
  "admin.reveal": "Reveal mobile for {name}",
  "admin.export": "Export CSV",
  "admin.title": "Fairsquare admin",
  "admin.tabs": "Overview / Leads / Requests / Sales data / Quality",
  "admin.range": "7 days / 30 days / 90 days",
  "admin.kpi":
    "Comparisons / Reads / Read failures / Shares created / Share page views / Comparisons from shares / Cost estimates opened / Adviser requests / Withdrawn",
  "admin.funnel": "New visitors / Reads / Comparisons / Shares / Share views / From shares / Leads",
  "admin.kFactor": "K-factor: {k} comparisons per comparison",
  "admin.showTable": "Show as table",
  "admin.leadStatus.new": "New",
  "admin.leadStatus.sent": "Sent to partner on {date}",
  "admin.leadStatus.withdrawn": "Withdrawn on {date}. Tell the partner.",
  "admin.leadStatus.notified": "Withdrawn on {date}. Partner told.",
  "admin.markSent": "Mark sent to partner",
  "admin.partnerTold": "Partner told",
  "admin.salesTabs": "Sales / Register a sale / Buildings / Import CSV",
  "admin.reference": "Reference (optional)",
  "admin.addBuilding": "Add building",
  "admin.addAlias": "Add alias",
  "admin.csvKind": "Sales / Buildings / Aliases",
  "admin.qualityEdited": "Fields people changed after reading",
  "admin.qualityFailures": "Read failures",
  "admin.qualityMedian": "Median read time: {s} s",
  "admin.freshness": "Latest sale by building",

  // ---------- 6.14 Scene, questions and result headline (docs/REDESIGN.md section 9) ----------
  "home.dropScale": "Drop a screenshot on the scale",
  "home.pasteKeys": "or paste it with {keys}",
  "home.dataSentence":
    "{building} had the most registered sales of ready {bedType} apartments in the {months} months to {to}: {count}, at a median of AED {median} per sq ft.",
  "home.dataRange": "Registered sales from {from} to {to}.",
  "scene.readingText": "Reading the listing text",
  "scene.weighing": "Weighing it against registered sales",
  /** No covered building was chosen (None of these, or nothing similar): nothing is claimed about its sales. */
  "scene.checking": "Looking for registered sales",
  "scene.slowMatch": "Still finding the building.",
  "scene.slowCompare": "Still comparing.",
  "scene.kept": "Your screenshot is still here.",
  "scene.keptText": "Your listing text is still here.",
  "scene.reducedHint": "This takes about 5 to 20 seconds.",
  "scene.read": "Read: {bedType}, {size} sq ft, AED {price}.",
  "scene.labelListing": "this listing, per sq ft",
  /** "singular / plural" (read with `tPlural`). */
  "scene.labelSales": "registered sale / registered sales",
  "scene.labelMedian": "median of {count} registered sales",
  "scene.partialH": "Fairsquare could only read part of this listing.",
  "scene.partialBody": "Type the details to finish, or try another screenshot.",
  "ask.buildingH": "Which building is this?",
  "ask.buildingSays": "The listing says “{text}”.",
  "ask.buildingNameH": "Which building is it in?",
  "ask.bedsH": "How many bedrooms?",
  "ask.sizeH": "What’s the size?",
  "ask.priceH": "What’s the asking price?",
  "ask.psfH": "Check the size and price.",
  "ask.notIn": "It isn’t in the screenshot.",
  "ask.notInText": "It isn’t in the listing text.",
  "ask.continue": "Continue",
  "ask.typeAll": "Type all the details instead",
  "ask.rentalH": "This looks like a rental listing.",
  "ask.rentalBody": "Fairsquare compares sale prices only.",
  "ask.notListingH": "That doesn’t look like a property listing.",
  "ask.notListingBody": "Try a screenshot that shows the price.",
  "ask.villaH": "This looks like a villa or townhouse.",
  "ask.villaBody": "Fairsquare compares apartments only for now.",
  "fail.timeout": "Reading took too long.",
  "fail.cutShort": "The reading was cut short.",
  "fail.read": "Reading failed.",
  "fail.refused": "Claude couldn’t read this one.",
  "fail.image": "That image couldn’t be read.",
  "fail.imageHint": "Try a JPEG or PNG screenshot.",
  "fail.busy": "Claude is busy right now.",
  "fail.off": "Screenshot reading is off right now.",
  "fail.offHint": "Typing the 4 details takes about 20 seconds.",
  "fail.limit": "That’s the limit for now.",
  "fail.offline": "You’re offline.",
  "fail.compare": "Couldn’t compare just now.",
  "result.headAbove": "{pct}% above",
  "result.headBelow": "{pct}% below",
  "result.headInline": "In line",
  "result.headRest": "registered sales",
  "result.headInlineRest": "with registered sales",
  "details.h2Typed": "Type the details",
  "details.back": "Back to the result",
  "how.figCaption": "How the balance reads a listing",
  "how.figListing": "Left: this listing, its asking price divided by its size.",
  "how.figSales": "Right: registered sales of the same apartment type in the same building, over {months} months.",
  "how.figBand": "Within {bandPct}% of their median either way counts as in line.",

  // ---------- 6.15 Result: fact line, market scale, sales list and share (RESULT_SPEC section 10) ----------
  /** The fact line: the listing's own building and area text, then what was read. */
  "fact.line1": "{building}, {area}.",
  /** `fact.line1` when the listing names no area. */
  "fact.line1NoArea": "{building}.",
  "fact.line2": "{basis} {bedType}, {size} sq ft, AED {price}.",
  /** `fact.line2` when the listing didn't say ready or off-plan: it starts with the capitalised bed type. */
  "fact.line2NoBasis": "{bedType}, {size} sq ft, AED {price}.",
  /** A size from a size button. */
  "fact.sizeAbout": "about {size}",
  "fact.edit": "Edit",
  "fact.editSr": "Edit the details",
  /** The scene's status line: the DLD building as DLD names it, then the sales being weighed. */
  "scene.statusMatch": "In DLD records as {building}, {area}.",
  "scene.statusSales": "{count} registered sales of {basis} {bedTypePlural} in the {months} months to {to}.",
  /** The gap sentence. `{pctParen}` is " (1.4%)" in line and empty above or below (the headline carries the %). */
  "result.gapAbove":
    "The asking price is AED {gap} per sq ft above the median{pctParen}, and higher than {k} of the {n} sales.",
  "result.gapBelow":
    "The asking price is AED {gap} per sq ft below the median{pctParen}, and lower than {k} of the {n} sales.",
  "result.gapZero": "The asking price is the same as the median, and higher than {k} of the {n} sales.",
  "result.aboveAll":
    "The asking price is AED {gap} per sq ft above the median{pctParen}, and higher than all {n} sales. The highest was AED {max} per sq ft, on {date}.",
  "result.belowAll":
    "The asking price is AED {gap} per sq ft below the median{pctParen}, and lower than all {n} sales. The lowest was AED {min} per sq ft, on {date}.",
  /**
   * The live region at the settle and at each re-settle (RESULT_SPEC 2.7 and 11): the headline, the
   * listing, its price per sq ft and the exact % against the median; then `card.recentLower` or
   * `card.recentHigher` when the recent-sales line shows. `{listingType}` as in the share text.
   */
  "result.announce":
    "{verdict}. {building}, {listingType}, AED {asking} per sq ft, {pct}% {above/below} the median of {count} registered sales.",
  "result.announceSame":
    "{verdict}. {building}, {listingType}, AED {asking} per sq ft, the same as the median of {count} registered sales.",
  /** The recent-sales line. `{dir}` is "higher" or "lower". */
  "result.recentLower":
    "Recent sales are lower. The {n} since {date} have a median of AED {m} per sq ft. This asking price is {dir} than {k} of them.",
  "result.recentHigher":
    "Recent sales are higher. The {n} since {date} have a median of AED {m} per sq ft. This asking price is {dir} than {k} of them.",
  "result.premiumLink": "Ask what explains the premium",
  "result.listingCheck":
    "Before you pay a deposit, check the listing is live. Ask for its Trakheesi permit number, or scan the Madmoun QR code on the ad.",
  "result.howToCheck": "How to check",
  /** The "How to check" sheet, one step per item (read with `tList`). */
  "result.howToCheckSteps":
    "Ask the agent for the Trakheesi permit number shown on the ad. / Scan the Madmoun QR code on the ad with your phone camera. It opens the permit details from the Dubai Land Department. / Check that the building, size and price on the permit match the listing.",
  /** The evidence line. `{dld}` is the DLD building name verbatim; `{setAside}` is evidence.setAsideNone or evidence.setAsideN. */
  "evidence.line":
    "{strength} evidence. {n} registered sales of {basis} {bedTypePlural} in {dld}, {from} to {to}, the latest on {latest}. {setAside} Not a valuation.",
  "evidence.strong": "Strong",
  "evidence.moderate": "Moderate",
  "evidence.limited": "Limited",
  /** The evidence popover. */
  "evidence.defStrong":
    "Strong evidence: 20 or more sales, at least 3 of them in the last 90 days, and the middle half of prices within 20% of the median.",
  "evidence.defHere":
    "Here: {n} sales, {recent} in the last 90 days, middle half AED {q1} to {q3} per sq ft ({spread}% of the median).",
  "evidence.defModerate": "Moderate evidence: 10 to 19 sales, or 20 or more that miss one of those tests.",
  "evidence.defLimited": "Limited evidence: {minSales} to 9 sales. One or two new sales can move the median.",
  "evidence.defCounts": "Fairsquare counts registered sales. It is not a valuation.",
  "evidence.setAsideNone": "None set aside.",
  /** "singular / plural" (read with `tPlural`). */
  "evidence.setAsideN": "{n} unusual sale set aside. / {n} unusual sales set aside.",
  "evidence.wrongBuilding": "Wrong building?",
  /** The evidence line of the too-few state. */
  "evidence.thinLine": "DLD building: {dld}. Not a valuation.",
  /** The market scale: its visually hidden title and summary, the legend, the labels and the readout. */
  "scale.title": "Where this asking price sits among {n} registered sales",
  "scale.summary":
    "Each dot is a registered sale of {article} {basis} {bedType} in {dld}, {from} to {to}. Lowest AED {min}, highest AED {max} per sq ft. Median AED {median}. This asking price, AED {asking}, is {dir} than {k} of them.",
  "scale.summaryRecent": "The {n} sales since {date} are filled; their median is AED {m}.",
  /** The summary with more than 80 sales, drawn as 40 dots: `{per}` sales a dot; `{k}` of the `{n}` sales. */
  "scale.summaryQuantile":
    "Each dot is about {per} registered sales of {article} {basis} {bedType} in {dld}, {from} to {to}. Lowest AED {min}, highest AED {max} per sq ft. Median AED {median}. This asking price, AED {asking}, is {dir} than {k} of the {n} sales.",
  "scale.summaryRecentQuantile":
    "A dot is filled when at least half of its sales are since {date}. The {n} sales since then have a median of AED {m}.",
  "scale.unit": "AED per sq ft.",
  "scale.unitOffPlan": "AED per sq ft, off-plan sales.",
  "scale.recent": "since {date}",
  "scale.older": "earlier",
  "scale.band": "within {bandPct}% of the median, AED {lo} to {hi}",
  "scale.median": "Median",
  /** The compact stamp on the scale (all caps: stamp text). */
  "scale.stampAsking": "ASKING",
  "scale.readout": "{date}: {size} sq ft, AED {price}, AED {psf} per sq ft.",
  "scale.readoutQuantile": "About {k} sales near AED {psf} per sq ft.",
  "scale.quantile": "Each dot is about {k} sales.",
  /** The sales list. `list.h` is "singular / plural" (read with `tPlural`). */
  "list.h": "{n} registered sale / {n} registered sales",
  "list.newest": "Newest first",
  "list.byPsf": "By price per sq ft",
  "list.colDate": "Registered",
  "list.sameSize3":
    "The {k} newest sales of the same size (within 3% of {size} sq ft) registered at AED {lo} to AED {hi}.",
  "list.sameSize1":
    "The newest sale of the same size (within 3% of {size} sq ft) registered at AED {p} on {date}.",
  "list.sameSizeTag": "same size",
  "list.setAsideTag": "set aside",
  "list.showAll": "Show all {n} sales",
  /** "Before you make an offer". */
  "offer.h": "Before you make an offer",
  "offer.spread":
    "Floor, view, condition and furnishing aren't in registered sales, and they can explain part of the spread.",
  "offer.premium": "{k} of the {n} sales were at AED {lo} per sq ft or more.",
  "offer.ask": "Ask the agent about",
  /** Read with `tList`. */
  "offer.items":
    "Floor and view / Vacant or tenanted, and until when / Service charge per sq ft / Upgrades since handover / The Trakheesi permit number",
  /** The size question's buttons, and the ready or off-plan question. */
  "ask.sizeCommon": "Usual {bedType} sizes in {building}",
  "ask.sizeChip": "About {size} sq ft",
  "ask.sizeChipSales": "{n} sales",
  "ask.sizeOr": "Or type it",
  "ask.completionH": "Is it ready or off-plan?",
  /** Read with `tList`. */
  "ask.completionOptions": "Ready / Off-plan",
  /** The "Change a detail" sheet. */
  "edit.h": "Change a detail",
  "edit.typeAll": "Type all the details",
  /** "More ways to share". */
  "share.more": "More ways to share",
  "share.image": "Send the card image",
  "share.copyText": "Copy text",
  /** The share card (RESULT_SPEC section 8.1). */
  "card.compared": "Compared {date}",
  "card.asking": "Asking, per sq ft",
  "card.median": "Median of {n} sales, per sq ft",
  "card.recent": "Last 90 days: median AED {m} per sq ft ({n} sales).",
  "card.dots": "Each dot is one registered sale. Filled: since {date}.",
  /** `card.dots` when no dot is filled (no sale in the last 90 days). */
  "card.dotsNoRecent": "Each dot is one registered sale.",
  /** More than 80 sales, drawn as 40 dots: a dot is filled when at least half of its sales are recent. */
  "card.dotsQuantile": "Each dot is about {k} registered sales. Filled: at least half since {date}.",
  "card.dotsQuantileNoRecent": "Each dot is about {k} registered sales.",
  "card.source":
    "Registered sales, {from} to {to}. DLD open data via Data.Dubai. Not a valuation. Fairsquare is independent of DLD.",
  "card.link": "See all {n} sales: {host}/c/{code}",
  /** The og:title verdict phrases (`{verdictPhrase}` in c.ogTitle) and og:description's recent note. */
  "c.ogVerdictAbove": "{pct}% above registered sales",
  "c.ogVerdictBelow": "{pct}% below registered sales",
  "c.ogVerdictInline": "in line with registered sales ({figure})",
  "c.ogRecentLower": "Recent sales lower.",
  "c.ogRecentHigher": "Recent sales higher.",
  /** The off-plan mismatch helper. */
  "offplan.mismatch": "This building has {n} ready {bedType} sales. Is the listing ready?",
  "offplan.compareReady": "Compare with ready sales",
  /** Provenance. */
  "provenance.basis":
    "This compares an asking price with registered sale prices, fees excluded on both. It is not a valuation or a forecast.",
  "provenance.lag": "Data to {date}; the latest weeks may be incomplete.",
  /** (added, RESULT_SPEC sections 3.2, 5, 6.4, 6.6 and 6.7) Strings the result needs beyond the section 10 table. */
  "thin.notHighLow": "This doesn’t mean the price is high or low.",
  "none.noMatch":
    "We couldn’t match “{building}” to a building in Dubai Land Department sales data. DLD may list it under the project or developer name.",
  "share.openCard": "Open the share card",
  "result.howToCheckLink": "Read about the Madmoun QR code",
  "list.sortLabel": "Sort the sales",
  "list.colNote": "Note",
  /** (added, RESULT_SPEC sections 7 and 8) The Change a detail rows, the share drawer's note, the card and the OG image. */
  "edit.size": "Size",
  "edit.price": "Asking price",
  "edit.completion": "Ready or off-plan",
  "edit.viewScreenshot": "View screenshot",
  "share.textCopied": "Text copied",
  "card.listing": "{listingType}, {size} sq ft, asking AED {price}",
  "card.askingLabel": "Asking {asking}",
  "card.recentLower": "Recent sales are lower.",
  "card.recentHigher": "Recent sales are higher.",
  "card.found": "Registered sales found",
  "card.foundValue": "{count} of the {minSales} needed",
  "card.thinLine":
    "Only {n} registered sale of {basis} {bedTypePlural} in this building in {months} months. / Only {n} registered sales of {basis} {bedTypePlural} in this building in {months} months.",
  "card.thinZero": "No registered sales of {basis} {bedTypePlural} in this building in {months} months.",
  "card.linkOnly": "See it on Fairsquare: {host}/c/{code}",
  /** (stage 4) The link alone, when the full line does not fit the card: the code always shows. */
  "card.linkShort": "{host}/c/{code}",
  "card.alt":
    "Fairsquare comparison card. {building}, {listingType}, {size} sq ft, asking AED {price}. {verdict}. Asking AED {asking} per sq ft, median of {count} sales AED {median} per sq ft. Not a valuation.",
  "card.altThin":
    "Fairsquare comparison card. {building}, {listingType}, {size} sq ft, asking AED {price}. Too few sales to compare yet: {count} of the {minSales} registered sales needed. Not a valuation.",
  "og.listing": "{listingType}, {size} sq ft, AED {price}",
  "og.figures": "Asking AED {asking}, median AED {median} per sq ft, {count} registered sales",
  "og.figuresThin": "Asking AED {asking} per sq ft, {count} of the {minSales} registered sales needed",
  "og.recent": "Last 90 days: AED {median} per sq ft ({count} sales)",
  "og.source": "DLD open data via Data.Dubai. Data to {date}. Not a valuation.",

  // ---------- (added) Admin UI labels, DESIGN.md section 3.8 (WP5; prefix "adminUi.") ----------
  "adminUi.navLabel": "Admin sections",
  "adminUi.sectionSelect": "Section",
  "adminUi.salesTabSelect": "Sales data section",
  "adminUi.showPassword": "Show password",
  "adminUi.hidePassword": "Hide password",
  "adminUi.signingIn": "Signing in...",
  "adminUi.overviewH1": "Overview",
  "adminUi.rangeLabel": "Date range",
  "adminUi.kpiLabel": "Key numbers",
  "adminUi.funnelH2": "Funnel",
  "adminUi.verdictsH2": "Verdicts",
  "adminUi.perDayH2": "Comparisons per day",
  "adminUi.perDaySummary": "Last {days} days: {checks} comparisons and {fails} read failures.",
  "adminUi.showChart": "Show as chart",
  "adminUi.kFactorNone": "K-factor: no comparisons yet",
  "adminUi.topRequestsH2": "Most requested buildings",
  "adminUi.topRequestsEmpty": "No building requests in this range.",
  "adminUi.covered": "Covered",
  "adminUi.notCovered": "Not covered",
  "adminUi.colDate": "Date",
  "adminUi.colCount": "Count",
  "adminUi.colShare": "Share",
  "adminUi.colVerdict": "Verdict",
  "adminUi.colStep": "Step",
  "adminUi.colField": "Field",
  "adminUi.colChanged": "Changed",
  "adminUi.colCode": "Code",
  "adminUi.colProblem": "Problem",
  "adminUi.colBuilding": "Building",
  "adminUi.colBedrooms": "Bedrooms",
  "adminUi.colLatestSale": "Latest sale",
  "adminUi.colSales12m": "Sales in 12 months",
  "adminUi.colReceived": "Received",
  "adminUi.colName": "Name",
  "adminUi.colMobile": "Mobile",
  "adminUi.colListing": "Listing",
  "adminUi.colConsent": "Consent",
  "adminUi.colStatus": "Status",
  "adminUi.colActions": "Actions",
  "adminUi.colTyped": "Building as typed",
  "adminUi.colArea": "Area",
  "adminUi.colRequests": "Requests",
  "adminUi.colPeople": "People",
  "adminUi.colFirstAsked": "First asked",
  "adminUi.colLastAsked": "Last asked",
  "adminUi.colSource": "Source",
  "adminUi.colSales": "Sales",
  "adminUi.colReference": "Reference",
  "adminUi.colAliases": "Aliases",
  "adminUi.colCompletion": "Completion",
  "adminUi.colRow": "Row",
  "adminUi.colBefore": "Median before",
  "adminUi.colAfter": "Median after",
  "adminUi.colAdded": "Sales added",
  "adminUi.sortBy": "Sort by {column}",
  "adminUi.none": "None",
  "adminUi.yes": "Yes",
  "adminUi.no": "No",
  "adminUi.cancel": "Cancel",
  "adminUi.retry": "Try again",
  "adminUi.qualityH1": "Quality",
  "adminUi.qualityMedianNone": "Median read time: no reads in this range",
  "adminUi.qualityNoFailures": "No read failures in this range.",
  "adminUi.qualityNoChecks": "No comparisons from screenshots in this range.",
  "adminUi.qualityBase": "Out of {n} comparisons from screenshots.",
  "adminUi.freshnessEmpty": "No sales recorded yet.",
  "adminUi.leadsH1": "Leads",
  "adminUi.listing": "{building}, {bedType}, AED {price}",
  "adminUi.receivedAt": "{date}, {time}",
  "adminUi.filterStatus": "Status",
  "adminUi.statusAll": "All",
  "adminUi.statusSent": "Sent to partner",
  "adminUi.statusWithdrawn": "Withdrawn",
  "adminUi.filterFrom": "From",
  "adminUi.filterTo": "To",
  "adminUi.filterApply": "Apply filters",
  "adminUi.filterClear": "Clear filters",
  "adminUi.leadsEmpty": "No leads match these filters.",
  "adminUi.nameRemoved": "Removed",
  "adminUi.revealCta": "Reveal",
  "adminUi.markedSent": "Marked as sent to partner",
  "adminUi.markedTold": "Marked as told",
  "adminUi.requestsH1": "Building requests",
  "adminUi.requestsEmpty": "No building requests yet.",
  "adminUi.coveredBy": "Covered: {building}",
  "adminUi.chooseBuilding": "Choose a building",
  "adminUi.searchBuildings": "Search buildings",
  "adminUi.noBuildingMatch": "No building matches.",
  "adminUi.linkedTo": "Linked to {building}",
  "adminUi.changeBuilding": "Change building",
  "adminUi.unlink": "Unlink",
  "adminUi.unlinked": "Unlinked. Requesters no longer see it as covered.",
  "adminUi.undo": "Undo",
  "adminUi.showMore": "Show {n} more",
  "adminUi.showingOf": "Showing {shown} of {total}",
  "adminUi.salesH1": "Sales data",
  "adminUi.allBuildings": "All buildings",
  "adminUi.allBedrooms": "All bedrooms",
  "adminUi.salesEmpty": "No sales match these filters.",
  "adminUi.salesLimit": "Showing the newest {n} sales.",
  "adminUi.deleteSaleLabel": "Delete the sale of {date}",
  "adminUi.saleDeleted": "Sale deleted",
  "adminUi.source.open_data": "DLD open data",
  /** (added, REAL_DATA.md section 12) The "Data source" panel on the Sales data page. */
  "adminUi.ds.h2": "Data source",
  "adminUi.ds.none": "No sales data is loaded. Build a snapshot with npm run data:build, commit data/open-data and deploy.",
  "adminUi.ds.pending":
    "The snapshot in data/open-data is not loaded yet. The server loads it in the background when it starts. If this stays, look for open_data_load_failed in the logs.",
  "adminUi.ds.loadFailed": "Couldn't load the data source details.",
  "adminUi.ds.stale":
    "The public pages show the stale-data note: the loaded sales end on {date}. Download a newer Transactions file and build a new snapshot (see the README).",
  "adminUi.ds.dataset": "Dataset",
  "adminUi.ds.publisher": "Publisher",
  "adminUi.ds.licence": "Licence",
  "adminUi.ds.downloaded": "Downloaded on",
  "adminUi.ds.range": "Data range",
  "adminUi.ds.rangeValue": "{from} to {to}",
  "adminUi.ds.rows": "Sales in the snapshot",
  "adminUi.ds.read": "Rows read",
  "adminUi.ds.buildings": "Buildings",
  "adminUi.ds.loadedAt": "Last loaded",
  "adminUi.ds.live": "In the database",
  "adminUi.ds.liveValue": "{sales} open-data sales in {buildings} buildings",
  "adminUi.ds.sha": "Snapshot",
  "adminUi.ds.excludedH": "Rows left out, by reason",
  "adminUi.ds.colReason": "Reason",
  "adminUi.ds.colRows": "Rows",
  /** One label per exclusion reason (src/lib/ingest/types.ts), in rule order. */
  "adminUi.reason.not_sales": "Not in the Sales group",
  "adminUi.reason.procedure_excluded": "Not a sale (mortgage, gift, lease, development and so on)",
  "adminUi.reason.not_flat": "Not a flat",
  "adminUi.reason.not_residential": "Not residential",
  "adminUi.reason.rooms_excluded": "Rooms not studio to 7 bedrooms",
  "adminUi.reason.no_building_name": "No building name",
  "adminUi.reason.no_area": "No area name",
  "adminUi.reason.no_size_or_price": "No size or price",
  "adminUi.reason.size_out_of_range": "Size under 150 or over 15,000 sq ft",
  "adminUi.reason.psf_out_of_range": "AED per sq ft outside 279 to 20,000",
  "adminUi.reason.bad_date": "Date not readable",
  "adminUi.reason.date_out_of_range": "Dated after the download",
  "adminUi.reason.no_transaction_id": "No transaction id",
  "adminUi.reason.repeated_in_other_file": "Already in an earlier file",
  "adminUi.reason.multi_unit_deal": "Multi-unit deal",
  "adminUi.reason.portfolio_deal": "Block of unlike units at one price (3 or more)",
  "adminUi.reason.size_unlike_building": "Size unlike the building's for those bedrooms",
  "adminUi.reason.outside_window": "Older than 36 months",
  /** (added) Filter for the Buildings tab (thousands of DLD buildings). */
  "adminUi.filterBuildings": "Search by name, area or other name",
  "adminUi.matchesShown": "Showing the first {n} matches. Type more to narrow them.",
  "adminUi.source.admin": "Added by admin",
  "adminUi.source.import": "Imported",
  "adminUi.completion.ready": "Ready",
  "adminUi.completion.off_plan": "Off-plan",
  "adminUi.impactNew":
    "The {bedType} median in {building} becomes AED {new} per sq ft. {n} saved listings will show a new sale.",
  "adminUi.impactOutside": "This date is outside the last 12 months, so no comparison changes.",
  "adminUi.registering": "Registering...",
  "adminUi.aed": "AED",
  "adminUi.chooseBedrooms": "Choose bedrooms",
  "adminUi.err.building": "Choose a building.",
  "adminUi.err.future": "The date can't be in the future.",
  "adminUi.err.salePrice": "Enter the sale price in AED, for example 2,236,000.",
  "adminUi.err.ref": "Use 64 characters or fewer.",
  "adminUi.err.refTaken": "A sale with this reference is already registered.",
  "adminUi.err.name": "Enter the building name.",
  "adminUi.err.nameTaken": "A building with this name already exists in this area.",
  "adminUi.err.completion": "Choose ready or off-plan.",
  "adminUi.err.area": "Enter the area.",
  "adminUi.err.alias": "Enter another name for the building.",
  "adminUi.err.textNorm": "Choose a request.",
  "adminUi.err.tooLong": "This is too long. Shorten it.",
  "adminUi.project": "Project (optional)",
  "adminUi.masterProject": "Master project (optional)",
  "adminUi.aliasesField": "Other names (optional, one per line)",
  "adminUi.aliasField": "Other name",
  "adminUi.addAliasFor": "Add alias for {building}",
  /** A building with its area (DLD names repeat across areas): pickers, labels and the sales table. */
  "adminUi.buildingWithArea": "{name}, {area}",
  "adminUi.addAliasCta": "Add",
  "adminUi.buildingAdded": "{building} added",
  "adminUi.aliasAdded": "Alias added",
  "adminUi.aliasExists": "That alias is already there.",
  "adminUi.adding": "Adding...",
  "adminUi.csvKindLabel": "What to import",
  "adminUi.csvColumns": "Columns: {columns}",
  "adminUi.csvSqm": "Use size_sqm instead of size_sqft for square metres.",
  "adminUi.csvChecking": "Checking the file...",
  "adminUi.csvRejectedH": "Rejected rows",
  "adminUi.csvDuplicates": "{n} rows are already in Fairsquare and will be skipped.",
  "adminUi.csvUpdated": "{n} buildings will be updated.",
  "adminUi.csvImpactH": "Effect on medians",
  "adminUi.csvAnother": "Choose another file",
  "adminUi.csvImportRows": "Import {ok} rows",
  "adminUi.csvDoneRows": "{ok} rows imported",
  "adminUi.csvNothing": "Nothing new to import.",
  "adminUi.csvMoreRejected": "Showing the first {n} rejected rows.",
  "adminUi.csvImporting": "Importing...",
  "adminUi.csvFile": "CSV file",
  "adminUi.csv.unknownBuilding": "Unknown building: {name}",
  "adminUi.csv.ambiguousBuilding": "More than one building is called {name}. Add an area column to say which.",
  "adminUi.csv.buildingMissing": "Building name is missing",
  "adminUi.csv.sizeMissing": "Size is missing",
  "adminUi.csv.sizeBad": "Size is out of range",
  "adminUi.csv.priceMissing": "Price is missing",
  "adminUi.csv.priceBad": "Price is out of range",
  "adminUi.csv.psf": "Price per sq ft looks wrong",
  "adminUi.csv.dateMissing": "Date is missing",
  "adminUi.csv.dateBad": "Date must look like 2026-11-17",
  "adminUi.csv.futureDate": "Date is in the future",
  "adminUi.csv.bedsBad": "Bedrooms must be 0 to 7, or studio",
  "adminUi.csv.completionBad": "Completion must be ready or off_plan",
  "adminUi.csv.refBad": "Reference is longer than 64 characters",
  "adminUi.csv.nameMissing": "Name is missing",
  "adminUi.csv.areaMissing": "Area is missing",
  "adminUi.csv.aliasMissing": "Alias is missing",
  "adminUi.csv.tooLong": "{column} is too long",
  "adminUi.csv.missingColumn": "Missing column: {column}",
  "adminUi.csv.tooManyRows": "The file has more than {max} rows.",
  "adminUi.csv.empty": "The file has no rows.",
  "adminUi.csv.noFile": "Choose a CSV file.",
  /** (added, REAL_DATA.md section 1) `npm run data:build` refusals. */
  "adminUi.ingest.dubailandExport":
    "This is the dubailand.gov.ae website export. Its terms allow personal, non-commercial use only and it has no building names. Download the Transactions dataset from data.dubai instead.",
  "adminUi.ingest.missingColumns":
    "This file is not the Data.Dubai Transactions dataset. Missing columns: {columns}.",
  "adminUi.ingest.emptyFile": "The file has no header row.",

  // ---------- 6.16 Similar buildings (the second tier, REAL_DATA.md section 15) ----------
  // Shown under "Too few sales to compare yet" only. A range, never one figure; never a price for the unit.
  "similar.h": "A range from more registered sales",
  "similar.intro":
    "This building has too few registered sales of its own to compare, so Fairsquare looked at more registered sales.",
  "similar.range":
    "They point to a median between AED {low} and AED {high} per sq ft for {basis} {bedTypePlural} in {building}, in the {months} months to {to}.",
  "similar.within": "This asking price, AED {asking} per sq ft, is within that range.",
  "similar.above": "This asking price, AED {asking} per sq ft, is above that range.",
  "similar.below": "This asking price, AED {asking} per sq ft, is below that range.",
  "similar.headWithin": "Within the range",
  "similar.headAbove": "Above the range",
  "similar.headBelow": "Below the range",
  "similar.tierClose": "Narrow range",
  "similar.tierBroad": "Broad range",
  "similar.sources": "The range is built from {list}.",
  "similar.and": "and",
  "similar.srcOwn":
    "{n} registered sale in this building in those {months} months / {n} registered sales in this building in those {months} months",
  "similar.srcOlder":
    "{n} earlier sale of the same type here, back to {from} / {n} earlier sales of the same type here, back to {from}",
  "similar.srcOtherBeds": "{n} sale of other bedroom types here / {n} sales of other bedroom types here",
  "similar.srcRef":
    "{n} registered sales of {basis} {bedTypePlural} in {k} other building {place} / {n} registered sales of {basis} {bedTypePlural} in {k} other buildings {place}",
  "similar.placeProject": "of the same project",
  "similar.placeNamed": "in {place}",
  "similar.placeArea": "in the same area",
  "similar.srcSpan": "Their medians run from AED {lo} to AED {hi} per sq ft.",
  "similar.weaker":
    "Other buildings are not matched on size or price level, and are weaker evidence than sales in this one. Not a valuation.",
  "similar.weakerOwn": "A few sales are weaker evidence than {minSales} or more in {months} months. Not a valuation.",
  "similar.tested":
    "In tests on buildings with many registered sales, a range built this way held the building's own median in about {held} of 10 cases, and in about {heldLater} of 10 against the six months that followed.",
  "similar.limits": "The range takes no account of size, floor, view or condition.",
  /** (stage 4) The range scale: its hidden title and summary, its legend and its readout. */
  "similar.scaleTitle": "Where this asking price sits against the range",
  "similar.scaleSummary":
    "A scale in AED per sq ft from {min} to {max}. The shaded range runs from AED {low} to AED {high}. The asking price, AED {asking}, is {position} it.",
  "similar.scaleOthers":
    "{k} other building is marked with a ring at the median of its registered sales. / {k} other buildings are marked with rings at the median of their registered sales, from AED {lo} to AED {hi}.",
  "similar.scaleOwn":
    "{n} registered sale in this building is marked with a filled dot. / {n} registered sales in this building are marked with filled dots.",
  "similar.asking": "Asking",
  "similar.endsJoined": "{low} to {high}",
  "similar.posWithin": "within",
  "similar.posAbove": "above",
  "similar.posBelow": "below",
  "similar.legendRange": "the range, AED {low} to {high}",
  "similar.legendOther": "another building, at its median",
  "similar.legendOtherK": "up to {k} other buildings",
  "similar.legendOwn": "a sale in this building",
  "similar.legendOff": "{n} more is off this scale. / {n} more are off this scale.",
  "similar.scaleCapped": "Only the {shown} with the most sales, of {k}, are on this scale.",
  "similar.readout":
    "{building}: {n} registered sale, median AED {psf} per sq ft. / {building}: {n} registered sales, median AED {psf} per sq ft.",
  "similar.readoutK": "{k} other buildings near AED {psf} per sq ft.",
  "similar.readoutOwn": "This building, {date}: {size} sq ft, AED {price}, AED {psf} per sq ft.",
  /** The list of similar buildings: open to everyone, closed until asked for. */
  "similar.listShow": "See the other building / See the {k} other buildings",
  "similar.listHide": "Hide the list",
  "similar.listNote":
    "Registered sales of {basis} {bedTypePlural}, {from} to {to}. Medians in AED per sq ft. Most sales first.",
  "similar.listCapped": "The {shown} with the most sales, of {k}.",
  "similar.listAll": "Show all {n}",
  "similar.colBuilding": "Building",
  "similar.colSales": "Sales",
  "similar.colMedian": "Median",
  "similar.defClose": "Narrow range: its ends are within about 10% of its middle.",
  "similar.defBroad": "Broad range: its ends are up to about 20% from its middle. Fairsquare shows nothing wider.",
  /** Sharing: one more sentence after share.textThin, and the lines of the /c preview and the card. */
  "similar.share":
    "More registered sales, {where}, point to a median between AED {low} and AED {high} per sq ft; the asking price, AED {asking} per sq ft, is {position} that range. Weaker evidence than {minSales} or more sales in the tower.",
  "similar.shareWhereOthers": "in this tower and in other buildings {place}",
  "similar.shareWhereOwn": "in this tower over three years",
  "similar.ogDesc":
    "Too few sales in this building to compare. More registered sales point to a median between AED {low} and AED {high} per sq ft. Weaker evidence. Not a valuation.",
  "similar.ogLine": "A range from more registered sales: AED {low} to {high} per sq ft",
  "similar.ogAlt": "A range from more registered sales runs from AED {low} to AED {high} per sq ft; the asking price is {position} it.",
  "similar.cardLabel": "The range from more registered sales, AED per sq ft",
  "similar.cardCaption": "Rings: other buildings, at their median. Weaker evidence.",
  "similar.cardCaptionOwn": "Weaker evidence than {minSales} or more sales in {months} months.",
  "similar.coverageNote":
    "A building with too few sales can still get a range from more registered sales: its own earlier sales and other buildings of its project, community or area. An off-plan building that is not in the data can get a range from other buildings of its project. It is weaker evidence.",
  "similar.coverageLink": "How that works",
  "how.similarH": "When a building has too few sales",
  "how.similarBody":
    "With fewer than {minSales} registered sales of a type in {months} months, Fairsquare can show a range in place of a single figure. The range combines the few sales the building has, its earlier sales, its other bedroom types and the medians of other buildings in the same project, community or area. Those other buildings are not matched on size or price level. The range shows only for studios to 3-beds, only when the building has registered sales of its own and never from the few sales of those {months} months alone, only when the building's own sales agree with each other and sit inside the range, and only when the range is narrow enough to say something. A building that is not in DLD sales data gets a range of this kind only in the one case below.",
  "how.similarTested":
    "Fairsquare tested this on buildings with many registered sales, by hiding most of their sales and building the range from the rest. The range held the building's own median in about {held} of 10 cases. Against the median of the six months that followed it held in about {heldLater} of 10, because prices move. For buildings that really have few sales the tests are less exact, and it held in about 6 to 8 of 10.",
  "how.similarWeaker":
    "A range from more registered sales is weaker evidence than a same-building comparison. It takes no account of size, floor, view or condition. Not a valuation.",
  /** The project route (REAL_DATA.md section 15.8): a building that is not in the data, other buildings of its project only. */
  "similar.projectH": "A range from other buildings in the {project} project",
  "similar.projectIntro":
    "This building has no registered sales in the data, so Fairsquare looked at registered sales in other buildings in the {project} project.",
  "similar.projectRange":
    "They point to a median between AED {low} and AED {high} per sq ft for {basis} {bedTypePlural} in a new building of this project, from sales in the {months} months to {to}.",
  "similar.projectSrc":
    "The range is built from {n} registered sales of {basis} {bedTypePlural} in {k} other building in the {project} project. / The range is built from {n} registered sales of {basis} {bedTypePlural} in {k} other buildings in the {project} project.",
  "similar.projectWeaker":
    "The building itself has no registered sales in the data. Other buildings are not matched on size or price level, and are weaker evidence than sales in the building itself. Not a valuation.",
  "similar.projectTested":
    "In tests on buildings as they first appeared in the data, using only the sales registered before them, a range built this way held the median of their first six months of registered sales in about {held} of 10 cases.",
  "similar.projectReach":
    "New buildings of a project have sold above its other buildings more often than below, so the range reaches further above their median than below it.",
  "similar.projectShare":
    "Registered sales in other buildings in the {project} project point to a median between AED {low} and AED {high} per sq ft; the asking price, AED {asking} per sq ft, is {position} that range. The building itself has no registered sales in the data. Weaker evidence. Not a valuation.",
  "similar.projectOgDesc":
    "No registered sales for this building in the data. Other buildings in the {project} project point to a median between AED {low} and AED {high} per sq ft. Weaker evidence. Not a valuation.",
  "similar.projectOgLine": "Other buildings in the {project} project: AED {low} to {high} per sq ft",
  "similar.projectOgAlt": "A range from other buildings in the {project} project runs from AED {low} to AED {high} per sq ft; the asking price is {position} it.",
  "how.similarProject":
    "A building that is not in DLD sales data gets no range of this kind, with one exception. When an off-plan listing names a project Fairsquare can identify in the data, and other buildings of that project have registered sales of the same type, Fairsquare can show a range from those other buildings, for studios to 3-beds. The page says that the building itself has no registered sales in the data. An area or a community alone never gives a range of this kind, and a ready building never gets one this way.",
  "how.similarProjectTested":
    "Fairsquare tested this on buildings as they first appeared in DLD data, using only the sales registered before them. The range held the median of their first six months of sales in about {held} of 10 cases. It rests on few projects, so it is weaker evidence still.",

  // ---------- (added) Adjusted registered sales, the first answer (REAL_DATA.md section 16, DESIGN.md section 6.17) ----------
  "acs.h": "Registered sales, adjusted to this listing",
  "acs.intro":
    "Fairsquare took {n} registered sales in {building} and adjusted each one to this listing: to {to} for its date and to {size} sq ft for its size.",
  "acs.introProject":
    "Fairsquare took {n} registered sales in {building} and in other buildings of its project, and adjusted each one to this listing: to {to} for its date and to {size} sq ft for its size.",
  "acs.range": "Adjusted this way, they point to a range of AED {low} to AED {high} per sq ft.",
  "acs.within": "This asking price, AED {asking} per sq ft, is within that range.",
  "acs.above": "This asking price, AED {asking} per sq ft, is above that range.",
  "acs.below": "This asking price, AED {asking} per sq ft, is below that range.",
  "acs.beyondHigh":
    "It is higher than all {n} adjusted sales; the highest is AED {psf} per sq ft.",
  "acs.beyondLow":
    "It is lower than all {n} adjusted sales; the lowest is AED {psf} per sq ft.",
  "acs.beyondWithin":
    "The range reaches further than the adjusted sales themselves because, in tests, later sale prices spread further than the sales before them.",
  "acs.headWithin": "Within the range of adjusted sales",
  "acs.headAbove": "Above the range of adjusted sales",
  "acs.headBelow": "Below the range of adjusted sales",
  "acs.posWithin": "within",
  "acs.posAbove": "above",
  "acs.posBelow": "below",
  "acs.sources": "The range is built from {list}, registered from {from} to {to}.",
  "acs.and": "and",
  "acs.srcOwn": "{n} sale of {bedTypePlural} in this building / {n} sales of {bedTypePlural} in this building",
  "acs.srcOtherBeds":
    "{n} sale of another bedroom type in this building / {n} sales of other bedroom types in this building",
  "acs.srcProject": "{n} sale in another building of the project / {n} sales in other buildings of the project",
  "acs.medianLine":
    "With no adjustment, the median of the {count} sales of the last {months} months is AED {median} per sq ft.",
  "acs.tested":
    "Fairsquare tested this on four past data dates. It built the range from the sales registered before each date, then looked at apartments sold in the six months after. About {held} of 10 of those later sale prices were inside the range.",
  "acs.limits":
    "The adjustments are for date, size and, for a sale of another bedroom type, bedrooms. Floor, view and condition are not in DLD sales data. Not a valuation.",
  "acs.howDate":
    "Date: each sale is moved to {to} with the movement of registered sale prices in its area since its month.",
  "acs.howSize":
    "Size: each sale is moved to {size} sq ft with the relation between size and AED per sq ft. For a sale of the same bedroom type in this building, that relation comes from this building's sales together with Dubai's registered sales of that type. For a sale of another bedroom type or in another building, it comes from Dubai's registered sales, and a sale of another bedroom type is also moved by the usual step between bedroom types.",
  "acs.howWeight":
    "How much a sale counts: recent sales and sales close in size count more. Sales of another bedroom type or in another building of the project count less.",
  "acs.listShow": "See the registered sale used / See the {n} registered sales used",
  "acs.listHide": "Hide the list",
  "acs.listNote":
    "Each row is a registered sale and what Fairsquare changed to compare it with this listing. The rows that count most are first.",
  "acs.listCapped": "The {shown} rows that count most, of {n}.",
  "acs.colDate": "Registered",
  "acs.colSize": "Size",
  "acs.colPsf": "AED per sq ft",
  "acs.colDateAdj": "For date",
  "acs.colSizeAdj": "For size",
  "acs.colBedAdj": "For bedrooms",
  "acs.colAdjusted": "Adjusted",
  "acs.colWeight": "Counts for",
  "acs.adjUp": "up {pct}%",
  "acs.adjDown": "down {pct}%",
  "acs.adjNone": "no change",
  "acs.rowOtherBeds": "{bedType} in this building",
  "acs.rowProject": "{building}, same project",
  "acs.rowBatch": "{n} apartments registered at one price per sq ft. The size is their median.",
  "acs.rowSame": "{n} sales registered with the same date, size and price.",
  "acs.readout": "{date}: {size} sq ft at AED {psf} per sq ft. Adjusted for date and size: AED {adjusted} per sq ft.",
  "acs.scaleTitle": "Where this asking price sits against the range of adjusted sales",
  "acs.scaleSummary":
    "The range runs from AED {low} to AED {high} per sq ft. The asking price, AED {asking} per sq ft, is {position} it. {n} adjusted registered sales are marked.",
  "acs.legendRange": "the range, AED {low} to {high}",
  "acs.legendSale": "a registered sale, adjusted",
  "acs.share":
    "Registered sales in this building, each adjusted to this listing, point to AED {low} to AED {high} per sq ft. The asking price, AED {asking} per sq ft, is {position} that range. Not a valuation.",
  "acs.shareProject":
    "Registered sales in this building and in other buildings of its project, each adjusted to this listing, point to AED {low} to AED {high} per sq ft. The asking price, AED {asking} per sq ft, is {position} that range. Not a valuation.",
  "acs.ogDesc":
    "{n} registered sales, each adjusted to this listing, point to AED {low} to AED {high} per sq ft. The asking price is {position} that range. Not a valuation.",
  "acs.ogLine": "Registered sales, adjusted to this listing: AED {low} to {high} per sq ft",
  "acs.ogAlt":
    "A range from registered sales adjusted to this listing runs from AED {low} to AED {high} per sq ft; the asking price is {position} it.",
  "acs.cardLabel": "Registered sales adjusted to this listing, AED per sq ft",
  /** (the interface) The headline's ink words after "Within the range"; the too-few bridge; the size note. */
  "acs.headRest": "of adjusted sales",
  "acs.fewLead":
    "A median needs {minSales} sales in {months} months, so there is none here. The range below comes from this building's registered sales of three years, each adjusted to this listing.",
  "acs.fewLeadProject":
    "A median needs {minSales} sales in {months} months, so there is none here. The range below comes from three years of registered sales in this building and in other buildings of its project, each adjusted to this listing.",
  "acs.sizeLarger":
    "This listing is {pct}% larger than the usual {bedType} sold in this building, {typical} sq ft. Each sale was adjusted for size; that adjustment is less exact this far from the usual size.",
  "acs.sizeSmaller":
    "This listing is {pct}% smaller than the usual {bedType} sold in this building, {typical} sq ft. Each sale was adjusted for size; that adjustment is less exact this far from the usual size.",
  "acs.leadOtherBeds":
    "Sales of other bedroom types in this building count for more of this range than its sales of {bedTypePlural}. Each of them was also adjusted for bedrooms.",
  /** The evidence line: the tested share in one sentence, the DLD building, and the definitions' trigger. */
  "acs.testedShort": "In tests, about {held} of 10 later sale prices were inside a range made this way.",
  "acs.dld": "DLD building: {dld}.",
  "acs.howLabel": "How the sales were adjusted",
  "acs.howShort":
    "Fairsquare adjusts each registered sale to the data date and to the listing's size, and shows the range they point to. The asking price is above, within or below that range.",
  /** The list of the sales used: its heading, its three groups and its phone rows. */
  "acs.listH": "The registered sale used / The {n} registered sales used",
  "acs.groupOwn": "This building, {bedTypePlural}",
  "acs.groupOtherBeds": "This building, other bedroom types",
  "acs.groupProject": "Other buildings of the project",
  "acs.listAll": "Show all {n} rows",
  "acs.rowRegistered": "{size} sq ft at AED {psf} per sq ft",
  "acs.rowAdjusted": "Adjusted: AED {psf}",
  "acs.rowCounts": "Counts for {pct}%",
  /** The scale: rings, grouped marks and their readouts. */
  "acs.legendOther": "another bedroom type or building, adjusted",
  "acs.legendSaleK": "up to {k} registered sales, adjusted",
  "acs.readoutK": "{k} adjusted sales near AED {psf} per sq ft.",
  "acs.readoutBeds":
    "{date}: {size} sq ft at AED {psf} per sq ft. Adjusted for date, size and bedrooms: AED {adjusted} per sq ft.",
  /** The card, the stamp (all caps), the link preview, the share text, the announcement and the scene. */
  "acs.cardRange": "Adjusted sales, per sq ft",
  "acs.cardRangeValue": "AED {low} to {high}",
  "acs.cardCaption": "Each dot is one registered sale, adjusted to this listing.",
  "acs.cardCaptionK": "Each dot is up to {k} registered sales, adjusted to this listing.",
  "acs.cardCaptionRows":
    "Each dot is one or more registered sales, adjusted.",
  "acs.cardSource":
    "Registered sales, {from} to {to}, each adjusted to {date}. DLD open data via Data.Dubai. Not a valuation. Fairsquare is independent of DLD.",
  "acs.cardSourceProject":
    "Registered sales in this building and its project, {from} to {to}, each adjusted to {date}. DLD open data via Data.Dubai. Not a valuation. Fairsquare is independent of DLD.",
  "acs.cardLink": "See the {n} sales used: {host}/c/{code}",
  "acs.cardAlt":
    "Fairsquare comparison card. {building}, {listingType}, {size} sq ft, asking AED {total}. {verdict}. Asking AED {asking} per sq ft; {n} registered sales, each adjusted to this listing, point to AED {low} to AED {high} per sq ft. Not a valuation.",
  "acs.stampWithin": "WITHIN",
  "acs.stampFigure": "{low} TO {high}",
  "acs.stampSales": "AED PER SQ FT FROM {n} REGISTERED SALES",
  "acs.stampDate": "ADJUSTED TO {date}",
  "acs.ogFigures": "Asking AED {asking} per sq ft, {n} registered sales adjusted",
  "acs.shareLead": "{building}, {listingType}, {size} sq ft, asking AED {total} (AED {asking} per sq ft).",
  "acs.announce":
    "{verdict}. {building}, {listingType}, AED {asking} per sq ft. {n} registered sales, each adjusted to this listing, point to AED {low} to AED {high} per sq ft.",
  "acs.sceneLabel": "range of {n} adjusted sales",
  "acs.saved": "Saved {date}: {position} the range of adjusted sales.",
  "how.acsH": "How registered sales are adjusted to a listing",
  "how.acsBody":
    "For a building in DLD sales data, Fairsquare first looks at its registered sales of the last three years: sales of the same bedroom type, sales of other bedroom types in the building, and sales of the same bedroom type in other buildings of its project. It moves each sale to the data date with the movement of registered sale prices in its area, and to the listing's size with the relation between size and AED per sq ft. For a sale of the same bedroom type in the building, that relation comes from the building's own sales together with Dubai's registered sales of that type; for the other sales it comes from Dubai's registered sales, and a sale of another bedroom type is also moved by the usual step between bedroom types. Recent sales and sales close in size count more. The result is a range, and the asking price is above, within or below it.",
  "how.acsFallback":
    "Fairsquare shows this range only for studios to 3-beds, only when the building has registered sales of the same bedroom type, only when the listing's size is close to the sizes sold, and only when the range is narrow enough to say something. In every other case it compares as described above: with the median of the building's sales, or with a range from more registered sales when there are too few.",
  "how.acsTested":
    "Fairsquare tested this on four past data dates. It built the range from the sales registered before each date, then looked at apartments sold in the six months after. About {held} of 10 of those later sale prices were inside the range. After prices fall, more of the later sales are under the range than over it.",
  "how.acsLimits":
    "The adjustments are for date, size and, for a sale of another bedroom type, bedrooms. Floor, view and condition are not in DLD sales data, so two apartments of one size in one building get the same range. Not a valuation.",

  // ---------- (added) Nearby registered sales, the last resort (REAL_DATA.md section 17, DESIGN.md section 6.18) ----------
  // Shown only when nothing else gives a comparison. Always says that the range comes from other buildings.
  "nearby.headWithin": "Within the range of nearby sales",
  "nearby.headAbove": "Above the range of nearby sales",
  "nearby.headBelow": "Below the range of nearby sales",
  "nearby.headRest": "of nearby sales",
  "nearby.posWithin": "within",
  "nearby.posAbove": "above",
  "nearby.posBelow": "below",
  /** Directly under the headline: what the building itself has, and where the range comes from. */
  "nearby.ownNone": "{building} has no registered sales of {basis} {bedTypePlural} in the {months} months to {to}.",
  "nearby.ownFew":
    "{building} has {count} registered sale of {basis} {bedTypePlural} in the {months} months to {to}. A comparison needs {minSales}. / {building} has {count} registered sales of {basis} {bedTypePlural} in the {months} months to {to}. A comparison needs {minSales}.",
  "nearby.ownOut": "Fairsquare could not find “{building}” in Dubai Land Department sales data, so there are no registered sales of this building to compare.",
  "nearby.fromOthers": "The range here comes from other buildings in {place}, not from this one.",
  "nearby.placeBoth": "{community} and the rest of {area}",
  "nearby.intro":
    "Fairsquare took {n} registered sales of {basis} {bedTypePlural} in {k} other buildings in {place} and adjusted each one to this listing: to {to} for its date and to {size} sq ft for its size.",
  "nearby.introAge":
    "Fairsquare took {n} registered sales of {basis} {bedTypePlural} in {k} other buildings in {place} and adjusted each one to this listing: to {to} for its date, to {size} sq ft for its size, and for the age of its building.",
  "nearby.range": "Adjusted this way, they point to a range of AED {low} to AED {high} per sq ft.",
  "nearby.within": "This asking price, AED {asking} per sq ft, is within that range.",
  "nearby.above": "This asking price, AED {asking} per sq ft, is above that range.",
  "nearby.below": "This asking price, AED {asking} per sq ft, is below that range.",
  /** The weakness note: always on the page. */
  "nearby.weak":
    "These sales are in other buildings. A building priced above or below its neighbours, for its brand, quality, view or age, will read above or below this range.",
  "nearby.tested": "In tests, about {held} of 10 later sale prices were inside a range made this way.",
  "nearby.weakOut": "Fairsquare could not find this building in DLD sales data. Its name may be registered differently.",
  "nearby.pick": "Find the building in DLD data",
  "nearby.dld": "DLD building: {dld}.",
  "nearby.notValuation": "Not a valuation.",
  "nearby.howLabel": "How the sales were adjusted",
  "nearby.howDate": "Date: each sale is moved to {to} with the movement of registered sale prices in its area since its month.",
  "nearby.howSize":
    "Size: each sale is moved to {size} sq ft with the relation between size and AED per sq ft in Dubai's registered sales of that bedroom type.",
  "nearby.howAge":
    "Building age: newer buildings register higher prices per sq ft. Each sale is moved from the age of its building to the age of this one, and buildings close to it in age count more.",
  "nearby.howAgeNew":
    "Building age: newer buildings register higher prices per sq ft. This building is not in the data, so each sale is moved from the age of its building to a newly launched one.",
  "nearby.howAgeNone": "Building age: not adjusted, because this building is not in the data and its age is not known.",
  "nearby.howWeight":
    "How much a sale counts: recent sales and sales close in size count more. A building with many sales counts no more than one building's full share.",
  "nearby.howArea": "Buildings outside {community} count less than buildings in it.",
  "nearby.howOwn": "This building's own registered sales are not part of the range.",
  "nearby.limits": "Floor, view, condition and what sets one building apart from the next are not in the adjustments. Not a valuation.",
  "nearby.howShort":
    "This building has no usable registered sales of its own. Fairsquare adjusts registered sales in other buildings nearby to the data date and to the listing's size, and shows the range they point to. The asking price is above, within or below that range.",
  /** The sales used: the buildings with their share, then the rows. */
  "nearby.listH": "The registered sale used / The {n} registered sales used",
  "nearby.listNote":
    "Each row is a registered sale in another building and what Fairsquare changed to compare it with this listing. The rows that count most are first.",
  "nearby.listCapped": "The {shown} rows that count most, of {n}.",
  "nearby.listAll": "Show all {n} rows",
  "nearby.buildingsH": "The building they are in / The {k} buildings they are in",
  "nearby.buildingsNote": "How much each building counts in the range. The building that counts most is first.",
  "nearby.buildingsCapped": "The {shown} buildings that count most, of {k}.",
  "nearby.buildingsAll": "Show all {k} buildings",
  "nearby.rowsH": "Each sale and its adjustments",
  "nearby.colBuilding": "Building",
  "nearby.colSales": "Sales",
  "nearby.colDate": "Registered",
  "nearby.colSize": "Size",
  "nearby.colPsf": "AED per sq ft",
  "nearby.colDateAdj": "For date",
  "nearby.colSizeAdj": "For size",
  "nearby.colAgeAdj": "For building age",
  "nearby.colAdjusted": "Adjusted",
  "nearby.colWeight": "Counts for",
  "nearby.rowRegistered": "{date}: {size} sq ft at AED {psf} per sq ft",
  "nearby.rowAdjusted": "Adjusted: AED {psf}",
  "nearby.rowCounts": "Counts for {pct}%",
  /** The scale. */
  "nearby.scaleTitle": "Where this asking price sits against the range of nearby sales",
  "nearby.scaleSummary":
    "The range runs from AED {low} to AED {high} per sq ft. The asking price, AED {asking} per sq ft, is {position} it. {n} adjusted registered sales in other buildings are marked.",
  "nearby.legendRange": "the range, AED {low} to {high}",
  "nearby.legendSale": "a registered sale in another building, adjusted",
  "nearby.legendSaleK": "up to {k} registered sales in other buildings, adjusted",
  "nearby.readout": "{building}, {date}: {size} sq ft at AED {psf} per sq ft. Adjusted: AED {adjusted} per sq ft.",
  "nearby.readoutK": "{k} adjusted sales near AED {psf} per sq ft.",
  /** Sharing, the link preview, the card, the stamp (all caps), Saved and the scene. */
  "nearby.shareLead": "{building}, {listingType}, {size} sq ft, asking AED {total} (AED {asking} per sq ft).",
  "nearby.shareIn":
    "This building has too few registered sales of its own to compare. {n} registered sales in other buildings in {place}, each adjusted to this listing, point to AED {low} to AED {high} per sq ft. The asking price, AED {asking} per sq ft, is {position} that range. Other buildings are weaker evidence than sales in this one.",
  "nearby.shareOut":
    "Fairsquare could not find this building in DLD sales data. {n} registered sales in other buildings in {place}, each adjusted to this listing, point to AED {low} to AED {high} per sq ft. The asking price, AED {asking} per sq ft, is {position} that range. Other buildings are weaker evidence than sales in this one.",
  "nearby.ogDescIn":
    "Too few registered sales in this building to compare. {n} registered sales in other buildings in {place} point to AED {low} to AED {high} per sq ft. The asking price is {position} that range. Not a valuation.",
  "nearby.ogDescOut":
    "This building is not in DLD sales data. {n} registered sales in other buildings in {place} point to AED {low} to AED {high} per sq ft. The asking price is {position} that range. Not a valuation.",
  "nearby.ogLine": "Other buildings nearby: AED {low} to {high} per sq ft",
  "nearby.ogFigures": "Asking AED {asking} per sq ft, {n} registered sales in other buildings",
  "nearby.ogAlt":
    "A range from registered sales in other buildings in {place} runs from AED {low} to AED {high} per sq ft; the asking price is {position} it.",
  "nearby.cardRange": "Nearby sales, per sq ft",
  "nearby.cardRangeValue": "AED {low} to {high}",
  "nearby.cardNoteIn": "From other buildings in {place}. This building has too few registered sales of its own.",
  "nearby.cardNoteOut": "From other buildings in {place}. This building is not in DLD sales data.",
  "nearby.cardLabel": "Registered sales in other buildings, adjusted, AED per sq ft",
  "nearby.cardCaption": "Each ring is one registered sale in another building, adjusted.",
  "nearby.cardCaptionK": "Each ring is up to {k} registered sales in other buildings, adjusted.",
  "nearby.cardSource":
    "Registered sales in other buildings in {place}, {from} to {to}, each adjusted to {date}. DLD open data via Data.Dubai. Not a valuation. Fairsquare is independent of DLD.",
  "nearby.cardLink": "See the {n} sales used: {host}/c/{code}",
  "nearby.cardAlt":
    "Fairsquare comparison card. {building}, {listingType}, {size} sq ft, asking AED {total}. {verdict}. Asking AED {asking} per sq ft; {n} registered sales in other buildings in {place}, each adjusted to this listing, point to AED {low} to AED {high} per sq ft. Not a valuation.",
  "nearby.stampWithin": "WITHIN",
  "nearby.stampFigure": "{low} TO {high}",
  "nearby.stampSales": "AED PER SQ FT, NEARBY REGISTERED SALES",
  "nearby.stampDate": "ADJUSTED TO {date}",
  "nearby.sceneLabel": "range of {n} nearby sales",
  "nearby.saved": "Saved {date}: {position} the range of nearby sales.",
  "nearby.coverageNote":
    "A building with no usable registered sales, or one that is not in the data, can still be compared with registered sales in other buildings nearby. The page names where they are and says that they are other buildings. It is weaker evidence.",
  "how.nearbyH": "When the building itself gives nothing to compare",
  "how.nearbyBody":
    "When none of the comparisons above can be made, because the building has too few registered sales or is not in DLD sales data, Fairsquare compares with registered sales nearby. It takes sales of the same bedroom type in other buildings of the same community over two years. When the community has fewer than three such buildings, it adds the rest of the DLD area and counts those less. It moves each sale to the data date, to the listing's size and, where it applies, to the age of the building. Recent sales and sales close in size count more, and a building with many sales counts no more than one building's full share. The result is a range, and the asking price is above, within or below it. The page says that the range comes from other buildings and names where they are. The building's own sales are never part of it.",
  "how.nearbyOut":
    "For a building that is not in the data, Fairsquare reads the area the listing gives. When that names no place Fairsquare can identify, there is no comparison. The building may also be in the data under another name: the page offers to find it.",
  "how.nearbyFallback":
    "Fairsquare shows this range only for studios to 3-beds, only with sales in at least three other buildings, only when the listing's size is close to the sizes sold, and only when the range is narrow enough to say something.",
  "how.nearbyTested":
    "Fairsquare tested this on four past data dates. It built the range from the sales registered before each date, then looked at apartments sold in the six months after. About {held} of 10 of those later sale prices were inside the range.",
  "how.nearbyWeak":
    "This is the weakest comparison Fairsquare makes. The sales are in other buildings. A building priced above or below its neighbours, for its brand, quality, view or age, will read above or below the range. For a ready apartment in a new building that is not yet in the data, only about half of the later sale prices were inside the range at the latest test date. Not a valuation.",

  // ---------- (added) Stamp text, DESIGN.md section 8.1 (all caps allowed only here) ----------
  "stamp.brand": "FAIRSQUARE",
  /** Row A's verdict word (RESULT_SPEC section 8.1): "FAIRSQUARE [scale] IN LINE". */
  "stamp.inLine": "IN LINE",
  "stamp.above": "ABOVE",
  "stamp.below": "BELOW",
  "stamp.tooFew": "TOO FEW",
  "stamp.vsMedian": "VS MEDIAN OF {count} {sales}",
  "stamp.salesLive": "REGISTERED SALES",
  "stamp.thinFigure": "{count} OF {min}",
  "stamp.salesNeeded": "SALES NEEDED TO COMPARE",
  "stamp.window": "{months} MONTHS TO {date}",
  /** Row D adds OFF-PLAN for an off-plan comparison only. */
  "stamp.offPlan": "OFF-PLAN",
  "stamp.noneFigure": "NOT COVERED",

  // ---------- (added) OG image, DESIGN.md section 8.4 ----------
  "og.brand": "Fairsquare",
  "og.sentenceNone": "Fairsquare doesn't cover this building yet.",
} as const satisfies Record<string, string>;

export type CopyDeck = typeof COPY;
export type CopyKey = keyof CopyDeck;
export type CopyVars = Record<string, string | number>;

const PLACEHOLDER_RE = /\{([^{}]+)\}/g;

/** The placeholder names in a string, in order ("{building} {bedType}" → ["building", "bedType"]). */
export function placeholders(s: string): string[] {
  return [...s.matchAll(PLACEHOLDER_RE)].map((m) => m[1]);
}

function fill(key: string, template: string, vars: CopyVars | undefined): string {
  return template.replace(PLACEHOLDER_RE, (_, name: string) => {
    const v = vars?.[name];
    if (v === undefined || v === null) {
      throw new Error(`copy: missing placeholder {${name}} for "${key}"`);
    }
    return String(v);
  });
}

/** Fill a deck string. Throws when a placeholder has no value. */
export function t(key: CopyKey, vars?: CopyVars): string {
  const template: string | undefined = COPY[key];
  if (template === undefined) throw new Error(`copy: unknown key "${String(key)}"`);
  return fill(key, template, vars);
}

/** The alternatives of a " / " list value ("Light / Dark / System" → ["Light", "Dark", "System"]). */
export function tList(key: CopyKey, vars?: CopyVars): string[] {
  return COPY[key].split(" / ").map((part) => fill(key, part, vars));
}

/** "singular / plural" keys such as `saved.newSales`; `{n}` is filled with `n`. */
export function tPlural(key: CopyKey, n: number, vars?: CopyVars): string {
  const [one, many = one] = COPY[key].split(" / ");
  return fill(key, n === 1 ? one : many, { n, ...vars });
}

// ---------- errors ----------

export const ERROR_COPY: Record<ErrorCode, string> = {
  bad_request: COPY["apiError.bad_request"],
  empty_input: COPY["apiError.empty_input"],
  validation_failed: COPY["apiError.validation_failed"],
  image_too_large: COPY["apiError.image_too_large"],
  file_too_large: COPY["apiError.file_too_large"],
  unsupported_image: COPY["error.badImage"],
  image_rejected: COPY["error.badImage"],
  extract_refused: COPY["error.refused"],
  extract_unreadable: COPY["error.cutShort"],
  extract_timeout: COPY["error.timeout"],
  extract_failed: COPY["error.readFailed"],
  extract_busy: COPY["rate.busy"],
  extract_unavailable: COPY["claudeOff.notice"],
  daily_cap_reached: COPY["rate.dailyCap"],
  rate_limited: COPY["rate.spam"],
  building_not_found: COPY["apiError.building_not_found"],
  not_found: COPY["cNotFound.h1"],
  leads_unavailable: COPY["lead.unavailable"],
  consent_required: COPY["apiError.consent_required"],
  consent_version_mismatch: COPY["apiError.consent_version_mismatch"],
  unauthorized: COPY["apiError.unauthorized"],
  bad_credentials: COPY["admin.wrong"],
  bad_origin: COPY["apiError.bad_origin"],
  internal: COPY["apiError.internal"],
};

/** The `rate_limited` message for a scope. `retryAfterSec` fills "Wait {n} minutes" (rounded up, at least 1). */
export function rateLimitMessage(scope: RateLimitScope, retryAfterSec?: number): string {
  switch (scope) {
    case "extract_burst":
      return t("rate.burst", { n: Math.max(1, Math.ceil((retryAfterSec ?? 60) / 60)) });
    case "extract_daily":
      return COPY["rate.daily"];
    case "admin_login":
      return COPY["admin.locked"];
    default:
      return COPY["rate.spam"];
  }
}

/** Recovery actions per extract outcome, in DESIGN.md section 5.3 order. */
export type OutcomeAction = "tryAnother" | "type" | "continue" | "typeAnyway";
export const OUTCOME_ACTIONS: Record<ExtractOutcome, OutcomeAction[]> = {
  ok: [],
  not_listing: ["tryAnother", "type"],
  rental: ["continue", "tryAnother"],
  not_apartment: ["typeAnyway", "tryAnother"],
};
const ACTION_LABEL: Record<OutcomeAction, string> = {
  tryAnother: COPY["alert.tryAnother"],
  type: COPY["home.type"],
  continue: COPY["alert.rentalContinue"],
  typeAnyway: COPY["alert.anyway"],
};

export const OUTCOME_COPY: Record<ExtractOutcome, { message: string; actions: string[] }> = {
  ok: { message: "", actions: [] },
  not_listing: { message: COPY["outcome.notListing"], actions: OUTCOME_ACTIONS.not_listing.map((a) => ACTION_LABEL[a]) },
  rental: { message: COPY["outcome.rental"], actions: OUTCOME_ACTIONS.rental.map((a) => ACTION_LABEL[a]) },
  not_apartment: {
    message: COPY["outcome.notApartment"],
    actions: OUTCOME_ACTIONS.not_apartment.map((a) => ACTION_LABEL[a]),
  },
};

/** Per-field messages (DESIGN.md section 6.4). */
export const FIELD_ERRORS: {
  buildingText: string;
  bedrooms: string;
  sizeSqft: string;
  priceAed: string;
  psf: (psf: number) => string;
  notFound: string;
  notFoundBeds: string;
} = {
  buildingText: COPY["err.building"],
  bedrooms: COPY["err.bedrooms"],
  sizeSqft: COPY["err.size"],
  priceAed: COPY["err.price"],
  psf: (psf: number) => t("err.psf", { psf: formatInt(psf) }),
  notFound: COPY["details.missing"],
  notFoundBeds: COPY["details.missingBeds"],
};

// ---------- consent ----------

export type ConsentVersion = "optin-v1";

/**
 * DESIGN.md section 6.8. The server builds the stored consent text with this, never the client.
 * Only with a configured partner (REAL_DATA.md section 8: PARTNER_NAME, PARTNER_REGULATOR and
 * PARTNER_LICENCE all set).
 */
export function consentFor(partnerName: string): { version: ConsentVersion; text: string } {
  return { version: "optin-v1", text: t("consent.v1", { PARTNER_NAME: partnerName }) };
}

// ---------- data source (REAL_DATA.md sections 7, 9 and 10) ----------

/** "Source: Dubai Land Department sales transactions, published as open data on Data.Dubai and used under the Dubai Open Data Licence." */
export function attributionText(): string {
  return t("data.attribution", { dataset: COPY["data.dataset"], licence: COPY["data.licence"] });
}

/**
 * `data.attribution` cut around its two linked names, for rendering with links: text, dataset name,
 * text, licence name, text. Joined, the parts are exactly `attributionText()`.
 */
export function attributionParts(): {
  before: string;
  dataset: string;
  between: string;
  licence: string;
  after: string;
} {
  const DATASET = "\u0000d\u0000";
  const LICENCE = "\u0000l\u0000";
  const s = t("data.attribution", { dataset: DATASET, licence: LICENCE });
  const [before, rest] = s.split(DATASET);
  const [between, after] = rest.split(LICENCE);
  return { before, dataset: COPY["data.dataset"], between, licence: COPY["data.licence"], after };
}

/** "Dubai Marina (DLD area: Marsa Dubai)", or just the area when the DLD name is missing or the same. */
export function areaLabel(area: string, areaDld: string | null | undefined): string {
  if (!areaDld || areaDld.trim().toLowerCase() === area.trim().toLowerCase()) return area;
  return t("area.withDld", { area, areaDld });
}

/** The stale-data note, or null when the data is fresh or not loaded. */
export function staleNote(data: { stale: boolean; dataThrough: IsoDate | null }): string | null {
  return data.stale && data.dataThrough ? t("data.stale", { date: formatDate(data.dataThrough) }) : null;
}

/** "ready" | "off-plan" (`{basis}`). */
export function basisWord(basis: CheckView["analysis"]["completionBasis"]): string {
  return COPY[`result.basis.${basis}`];
}

// ---------- builders over a CheckView ----------

type Verdict = "above" | "below" | "inline";

function verdictOf(c: Pick<CheckView, "analysis">): Verdict | null {
  const b = c.analysis.band;
  return (b === "above" || b === "below" || b === "inline") && c.analysis.diff !== null ? b : null;
}

/** The building as shown: the covered building's name, or the typed text when not covered. */
export function buildingLabel(c: Pick<CheckView, "building" | "buildingText">): string {
  return c.building?.name ?? c.buildingText;
}

/** `{salesAdj}`: every sale is a registered DLD sale (REAL_DATA.md section 9). */
export function salesAdj(): "registered" {
  return "registered";
}

/** `{sales}`: "registered sales" (REAL_DATA.md section 9; DATA_SOURCE_LABEL is gone). */
export function salesNoun(): "registered sales" {
  return "registered sales";
}

const saleWord = (n: number) => (n === 1 ? "sale" : "sales");

// ---------- adjusted registered sales: who leads (DESIGN.md section 6.17, REAL_DATA.md section 16) ----------

type AcsCheck = Pick<CheckView, "analysis"> & Partial<Pick<CheckView, "acs" | "building">>;

/**
 * The range of adjusted registered sales a comparison shows, or null: none stored (every comparison
 * made before it existed), switched off, refused, or not safe to draw (`shownAcs`). Never without a
 * matched building or on a not-covered comparison. Null means the page is exactly what it was.
 */
export function acsShown(c: AcsCheck): ShownAcs | null {
  if (!c.building || c.analysis.band === "none") return null;
  return shownAcs(c.acs);
}

/**
 * The same range when it leads the result (the building had its 5 or more sales): the headline, the
 * stamp, the card and the link preview are then its, and the fixed band is not used. With too few
 * sales the range shows in its own section under the unchanged too-few result (`acsShown` without
 * `acsLead`).
 */
export function acsLead(c: AcsCheck): ShownAcs | null {
  return verdictOf(c) ? acsShown(c) : null;
}

type AcsVerdict = ShownAcs["verdict"];
const ACS_HEAD = { within: "acs.headWithin", above: "acs.headAbove", below: "acs.headBelow" } as const;
const ACS_POS = { within: "acs.posWithin", above: "acs.posAbove", below: "acs.posBelow" } as const;
const ACS_SENTENCE = { within: "acs.within", above: "acs.above", below: "acs.below" } as const;

/** The headline of a leading range in its two parts: "Within the range" (the verdict hue) and "of adjusted sales" (ink). */
export function acsHead(verdict: AcsVerdict): { figure: string; rest: string } {
  const full: string = COPY[ACS_HEAD[verdict]];
  const rest: string = COPY["acs.headRest"];
  return full.endsWith(` ${rest}`) ? { figure: full.slice(0, -rest.length - 1), rest } : { figure: full, rest: "" };
}

/** The verdict hue of a range's outcome: within reads as in line. */
export function acsTone(verdict: AcsVerdict): "above" | "inline" | "below" {
  return verdict === "within" ? "inline" : verdict;
}

/** The figures of a shown range as copy variables ("1,550", "1,970", "1,908", "within", 12), or null. */
export function acsRange(c: AcsCheck): { low: string; high: string; asking: string; position: string; n: string } | null {
  const a = acsShown(c);
  if (!a) return null;
  return {
    low: formatInt(a.rangeLowPsf),
    high: formatInt(a.rangeHighPsf),
    asking: formatInt(c.analysis.askingPsf),
    position: COPY[ACS_POS[a.verdict]],
    n: formatInt(a.evidence.sales),
  };
}

/**
 * The dates the registered sales used run between: the earliest and the latest sale listed, or the
 * whole three years when the list is cut (200 rows at most). The page, the card and the alt texts
 * give the same two dates.
 */
export function acsDates(a: ShownAcs): { from: IsoDate; last: IsoDate; complete: boolean } {
  const complete = a.comparables.length >= a.comparablesTotal;
  const dates = a.comparables.map((r) => r.date).sort();
  return complete && dates.length ? { from: dates[0], last: dates[dates.length - 1], complete } : { from: a.poolFrom, last: a.dataThrough, complete };
}

/** The WhatsApp sentence of a shown range: "this building", or "this building and other buildings of its project" when their sales are used. */
function acsShareSentence(c: AcsCheck): string | null {
  const a = acsShown(c);
  const vars = acsRange(c);
  if (!a || !vars) return null;
  return t(a.evidence.projectSales > 0 ? "acs.shareProject" : "acs.share", vars);
}

/** The figure on the stamp and in titles: "+14.0%", "2 OF 3", or "NOT COVERED". */
export function stampFigure(c: CheckView): string {
  const v = verdictOf(c);
  if (v) return formatPct(c.analysis.diff as number);
  if (c.analysis.band === "none") return COPY["stamp.noneFigure"];
  return t("stamp.thinFigure", { count: c.analysis.count, min: c.rules.minSales });
}

/**
 * The comparison rules a check was made under (`{bandPct}`, `{minSales}`, `{months}`). They come from
 * the stored check, never from today's environment, so a sentence always describes its own result.
 */
export function ruleVars(rules: Pick<CheckView["rules"], "bandPct" | "minSales" | "windowDays">) {
  return { bandPct: rules.bandPct, minSales: rules.minSales, months: windowMonths(rules.windowDays) };
}

/** result.howBody: the method with the comparison's own rules and its window's real end date. */
export function howBody(c: Pick<CheckView, "rules" | "analysis"> & Partial<Pick<CheckView, "acs" | "building" | "similar" | "nearby">>): string {
  // A range of adjusted registered sales is on the page: say that method, not the fixed band.
  if (acsShown(c)) return COPY["acs.howShort"];
  // The last resort is on the page: say that it reads other buildings.
  if (nearbyShown(c)) return COPY["nearby.howShort"];
  return t("result.howBody", { ...ruleVars(c.rules), to: formatDate(c.analysis.windowEnd) });
}

function verdictVars(c: CheckView) {
  const a = c.analysis;
  return {
    ...ruleVars(c.rules),
    asking: formatInt(a.askingPsf),
    median: a.medianPsf === null ? "" : formatInt(a.medianPsf),
    pct: a.diff === null ? "" : formatPctNumber(a.diff),
    "above/below": a.band === "below" ? "below" : "above",
    count: a.count,
    salesAdj: salesAdj(),
    sales: salesNoun(),
    basis: basisWord(a.completionBasis),
    to: formatDate(a.windowEnd),
    bedType: bedsLabel(c.bedrooms),
    building: buildingLabel(c),
    "sale/sales": saleWord(a.count),
    price: formatInt(c.priceAed),
  };
}

/**
 * The result sentence: result.sentenceAbove|Below|Inline, thin.body (thin.bodyZero at 0),
 * or none.body when `buildingsCovered` is given (else none.h2 as a sentence). Each names the
 * completion basis ("ready" or "off-plan" apartments) and the window's real end date.
 */
export function verdictSentence(c: CheckView, buildingsCovered?: number): string {
  const vars = verdictVars(c);
  const v = verdictOf(c);
  if (v === "above") return t("result.sentenceAbove", vars);
  if (v === "below") return t("result.sentenceBelow", vars);
  if (v === "inline") return t("result.sentenceInline", vars);
  if (c.analysis.band === "none") {
    if (buildingsCovered === undefined) return `${t("none.h2", vars)}.`;
    return t("none.body", { n: buildingsCovered });
  }
  return c.analysis.count === 0 ? t("thin.bodyZero", vars) : t("thin.body", vars);
}

/**
 * The verdict headline's parts (docs/REDESIGN.md section 8.5): the figure and direction words, which
 * alone take the verdict colour, and the rest in ink. "14.3% above" + "registered sales", "In line" +
 * "with registered sales"; too few and not covered have no figure. Shared by the result, /c, the card
 * and the OG image.
 */
export function verdictHead(band: CheckView["analysis"]["band"], diff: number | null): { figure: string | null; rest: string } {
  if ((band === "above" || band === "below") && diff !== null) {
    return {
      figure: t(band === "above" ? "result.headAbove" : "result.headBelow", { pct: formatPctNumber(diff) }),
      rest: COPY["result.headRest"],
    };
  }
  if (band === "inline") return { figure: COPY["result.headInline"], rest: COPY["result.headInlineRest"] };
  if (band === "thin") return { figure: null, rest: COPY["thin.h2"] };
  return { figure: null, rest: COPY["band.none"] };
}

/**
 * The headline of a comparison with its hue: the range of adjusted registered sales when it leads
 * ("Within the range" + "of adjusted sales"), else `verdictHead` of the stored same-building result.
 */
export function verdictHeadOf(c: NearbyCheck): { figure: string | null; rest: string; tone: CheckView["analysis"]["band"] } {
  // The last resort: "Above the range" + "of nearby sales", in place of "Too few sales to compare yet" / "Not covered yet".
  const near = nearbyShown(c);
  if (near) return { ...nearbyHead(near.verdict), tone: acsTone(near.verdict) };
  const lead = acsLead(c);
  if (lead) return { ...acsHead(lead.verdict), tone: acsTone(lead.verdict) };
  return { ...verdictHead(c.analysis.band, c.analysis.diff), tone: c.analysis.band };
}

/** The headline as one string: "In line with registered sales", "Within the range of adjusted sales". */
export function verdictHeadText(c: NearbyCheck): string {
  const { figure, rest } = verdictHeadOf(c);
  return figure ? (rest ? `${figure} ${rest}` : figure) : rest;
}

/**
 * The provenance after `attributionText()` (result.source.live): the window's real dates, same
 * building, the basis and bedrooms. "Sales from 17 Nov 2025 to 17 Nov 2026, same building, ready
 * 2-bed apartments, per sq ft."
 */
export function provenanceLine(c: CheckView): string {
  return t("result.source.live", {
    from: formatDate(c.analysis.windowStart),
    to: formatDate(c.analysis.windowEnd),
    basis: basisWord(c.analysis.completionBasis),
    bedType: bedsLabel(c.bedrooms),
  });
}

/**
 * "Building: Test Tower A, Dubai Marina (DLD area: Marsa Dubai)." (REAL_DATA.md section 6), or null
 * for a comparison with no covered building. The DLD area is left out when it is not known.
 */
export function buildingAreaLine(c: Pick<CheckView, "building">): string | null {
  if (!c.building) return null;
  const area = c.building.area ? areaLabel(c.building.area, c.building.areaDld) : null;
  return area ? t("result.building", { building: c.building.name, area }) : null;
}

/** "1 unusual sale left out" (REAL_DATA.md section 7), or null when none was. */
export function outliersNote(a: Pick<CheckView["analysis"], "outliersDropped">): string | null {
  return a.outliersDropped > 0 ? tPlural("result.outliers", a.outliersDropped) : null;
}

/**
 * How many compared sales Fairsquare added itself (admin registrations and imports, not DLD open data,
 * REAL_DATA.md section 9): "2 of these sales were added by Fairsquare, …", "These sales were added by
 * Fairsquare, …" when all were, or null when every sale is open data.
 */
export function addedSalesNote(sales: ReadonlyArray<Pick<SaleView, "source">>): string | null {
  const added = sales.filter((s) => s.source !== undefined).length;
  if (added === 0) return null;
  return added === sales.length ? COPY["result.addedAll"] : tPlural("result.addedSome", added, { n: formatInt(added) });
}

/**
 * "Showing the newest 2,000 of 2,312 sales." when the comparison used more sales than it stores
 * (SNAPSHOT_MAX), else null: the list never silently shows fewer sales than the verdict counts.
 */
export function salesShownNote(c: Pick<CheckView, "sales" | "analysis">): string | null {
  if (c.sales.length === 0 || c.sales.length >= c.analysis.count) return null;
  return t("result.salesShown", { shown: formatInt(c.sales.length), count: formatInt(c.analysis.count) });
}

/**
 * The size check (REAL_DATA.md section 7): "This listing is 24% larger than the typical sale here…"
 * when the listing's size differs from the median size of the compared sales by more than 20%.
 */
export function sizeNote(c: Pick<CheckView, "sizeSqft" | "analysis">): string | null {
  const d = sizeDifference(c.sizeSqft, c.analysis.medianSizeSqft);
  if (d === null) return null;
  return t(d > 0 ? "result.sizeLarger" : "result.sizeSmaller", { pct: Math.round(Math.abs(d) * 100) });
}

/**
 * The size note of a shown range (DESIGN.md section 6.17): the listing is more than 20% larger or
 * smaller than the usual size sold in the building for its bedroom count (`typicalSizeSqft`). The
 * sales were adjusted for size, and the note says that this adjustment is less exact that far out.
 */
export function acsSizeNote(c: AcsCheck & Pick<CheckView, "sizeSqft" | "bedrooms">): string | null {
  const a = acsShown(c);
  if (!a) return null;
  const d = sizeDifference(c.sizeSqft, a.typicalSizeSqft);
  if (d === null || a.typicalSizeSqft === null) return null;
  return t(d > 0 ? "acs.sizeLarger" : "acs.sizeSmaller", { pct: Math.round(Math.abs(d) * 100), bedType: bedsLabel(c.bedrooms), typical: formatInt(a.typicalSizeSqft) });
}

export interface StampProps {
  /** Row A's verdict word: "IN LINE", "ABOVE", "BELOW" or "TOO FEW" ("" when not covered). */
  header: string;
  figure: string;
  lines: { c: string; d: string[] };
  date: IsoDate;
  seed: number;
}

/** Window length in months for the stamp ("12 MONTHS"). */
export function windowMonths(windowDays: number): number {
  return Math.max(1, Math.round((windowDays * 12) / 365));
}

const STAMP_WORD = { inline: "stamp.inLine", above: "stamp.above", below: "stamp.below" } as const;

/**
 * The verdict stamp (RESULT_SPEC section 8.1): row A is `stamp.brand` + glyph + the verdict word (IN
 * LINE, ABOVE, BELOW or TOO FEW); B the figure ("+1.4%", "4 OF 5"); C "VS MEDIAN OF 43 REGISTERED
 * SALES" (too few: "SALES NEEDED TO COMPARE"); D "2-BED <> 12 MONTHS TO 16 NOV 2026", with "<> OFF-PLAN"
 * only for an off-plan comparison. A not-covered comparison has no stamp; its props carry "NOT COVERED".
 */
export function stampProps(c: CheckView): StampProps {
  const a = c.analysis;
  const v = verdictOf(c);
  // A leading range of adjusted registered sales: "WITHIN", "1,550 TO 1,970", "AED PER SQ FT FROM
  // 12 REGISTERED SALES", "2-BED <> ADJUSTED TO 10 NOV 2026". No percentage: the outcome is against the range.
  const lead = acsLead(c);
  if (lead) {
    return {
      header: lead.verdict === "within" ? COPY["acs.stampWithin"] : COPY[lead.verdict === "above" ? "stamp.above" : "stamp.below"],
      figure: t("acs.stampFigure", { low: formatInt(lead.rangeLowPsf), high: formatInt(lead.rangeHighPsf) }),
      lines: {
        c: t("acs.stampSales", { n: lead.evidence.sales }),
        d: [
          bedsLabel(c.bedrooms).toUpperCase(),
          t("acs.stampDate", { date: formatDate(lead.dataThrough).toUpperCase() }),
          ...(a.completionBasis === "off_plan" ? [COPY["stamp.offPlan"]] : []),
        ],
      },
      date: lead.dataThrough,
      seed: codeSeed(c.code),
    };
  }
  // The last resort: "ABOVE", "990 TO 1,770", "AED PER SQ FT, NEARBY REGISTERED SALES". It claims no more than that.
  const near = nearbyShown(c);
  if (near) {
    return {
      header: near.verdict === "within" ? COPY["nearby.stampWithin"] : COPY[near.verdict === "above" ? "stamp.above" : "stamp.below"],
      figure: t("nearby.stampFigure", { low: formatInt(near.rangeLowPsf), high: formatInt(near.rangeHighPsf) }),
      lines: {
        c: COPY["nearby.stampSales"],
        d: [
          bedsLabel(c.bedrooms).toUpperCase(),
          t("nearby.stampDate", { date: formatDate(near.dataThrough).toUpperCase() }),
          ...(a.completionBasis === "off_plan" ? [COPY["stamp.offPlan"]] : []),
        ],
      },
      date: near.dataThrough,
      seed: codeSeed(c.code),
    };
  }
  const header = v ? COPY[STAMP_WORD[v]] : a.band === "thin" ? COPY["stamp.tooFew"] : "";
  const lineC = v
    ? t("stamp.vsMedian", { count: a.count, sales: COPY["stamp.salesLive"] })
    : a.band === "thin"
      ? COPY["stamp.salesNeeded"]
      : "";
  const d = [
    bedsLabel(c.bedrooms).toUpperCase(),
    t("stamp.window", { months: windowMonths(c.rules.windowDays), date: formatDate(a.windowEnd).toUpperCase() }),
    ...(a.completionBasis === "off_plan" ? [COPY["stamp.offPlan"]] : []),
  ];
  return { header, figure: stampFigure(c), lines: { c: lineC, d }, date: a.windowEnd, seed: codeSeed(c.code) };
}

/**
 * `{listingType}`: the listing as it describes itself, "ready 2-bed" or "off-plan 2-bed", or just
 * "2-bed" when it didn't say (the fact line leaves the basis out then too, RESULT_SPEC 2.4). The
 * comparison still names the sales it used where it describes them.
 */
export function listingType(c: Pick<CheckView, "completion" | "bedrooms" | "analysis">): string {
  const bedType = bedsLabel(c.bedrooms);
  return c.completion === "ready" || c.completion === "off_plan" ? `${basisWord(c.analysis.completionBasis)} ${bedType}` : bedType;
}

/** `{size}`: "812", or "about 815" when the size came from a size button (`sizeSource` "cluster"). */
export function sizeText(c: Pick<CheckView, "sizeSqft" | "sizeSource">): string {
  const size = formatInt(c.sizeSqft);
  return c.sizeSource === "cluster" ? t("fact.sizeAbout", { size }) : size;
}

/** read.slow with the measured median read time in seconds, or read.slowFallback until it is known. */
export function readSlowText(p50Seconds?: number | null): string {
  return p50Seconds && p50Seconds > 0 ? t("read.slow", { s: Math.round(p50Seconds) }) : COPY["read.slowFallback"];
}

/** The recent-sales line's trigger and median for a comparison with a verdict, else null. */
function recentShown(c: CheckView): RecentSet | null {
  if (!verdictOf(c)) return null;
  const r = recentSet(c);
  return r.trigger && r.medianPsf !== null ? r : null;
}

/**
 * The live region's words when a result settles or re-settles (RESULT_SPEC 2.7 and 11): with a
 * verdict, "In line with registered sales. Aykon City Tower C, ready 2-bed, AED 1,786 per sq ft, 1.4%
 * above the median of 43 registered sales. Recent sales are lower." (the last sentence only when the
 * recent-sales line shows); too few and not covered say their sentence (`verdictSentence`).
 */
export function verdictAnnouncement(c: CheckView): string {
  const v = verdictOf(c);
  if (!v) {
    // The last resort answers: its outcome, what the building itself has, and where the range comes from.
    const near = nearbyLines(c);
    if (near) return near.announce;
    // Too few sales: the range of adjusted registered sales follows the sentence when it shows; else
    // the second tier's sentences when a range shows there.
    const acs = acsLines(c);
    if (acs) return `${verdictSentence(c)} ${acs.announce}`;
    const similar = similarLines(c);
    return similar ? `${verdictSentence(c)} ${similar.announce}` : verdictSentence(c);
  }
  const lead = acsRange(c);
  if (lead && acsLead(c)) {
    return t("acs.announce", { ...lead, verdict: verdictHeadText(c), building: c.buildingText, listingType: listingType(c) });
  }
  const a = c.analysis;
  const diff = a.diff as number;
  const pct = formatPctNumber(diff);
  const vars = {
    verdict: verdictHeadText(c),
    building: c.buildingText,
    listingType: listingType(c),
    asking: formatInt(a.askingPsf),
    count: a.count,
    pct,
    "above/below": diff < 0 ? "below" : "above",
  };
  const parts = [t(pct === "0.0" ? "result.announceSame" : "result.announce", vars)];
  const recent = recentShown(c);
  if (recent) parts.push(COPY[recent.direction === "lower" ? "card.recentLower" : "card.recentHigher"]);
  return parts.join(" ");
}

/**
 * The WhatsApp text (RESULT_SPEC section 8.2): share.text (above or below), share.textInline or
 * share.textThin (share.textThinZero with no sales) with the listing's own building text, then
 * share.recent when the recent-sales line shows, then share.source with the link. Not covered:
 * share.textNone (the link only, no card).
 */
export function shareText(c: CheckView): string {
  // The last resort: the listing, then what the building itself has and what the other buildings point to.
  const near = nearbyShown(c);
  const nearVars = nearbyRange(c);
  if (near && nearVars) {
    return [
      t("nearby.shareLead", { building: c.buildingText, listingType: listingType(c), size: sizeText(c), total: formatInt(c.priceAed), asking: nearVars.asking }),
      t(near.kind === "in" ? "nearby.shareIn" : "nearby.shareOut", nearVars),
      t("share.source", { url: c.url }),
    ].join(" ");
  }
  if (c.analysis.band === "none") {
    // The project route: its sentence goes before the not-covered line, which ends with the link.
    const project = similarProject(c);
    const range = similarRange(c);
    const none = t("share.textNone", { ...verdictVars(c), url: c.url });
    return project && range ? `${t("similar.projectShare", { ...range, project })} ${none}` : none;
  }
  const vars = { ...verdictVars(c), building: c.buildingText, listingType: listingType(c), size: sizeText(c) };
  const v = verdictOf(c);
  const thin = c.analysis.count === 0 ? "share.textThinZero" : "share.textThin";
  const acs = acsRange(c);
  if (acs && v) {
    // A leading range: the listing, then what the adjusted registered sales point to. No median, no percentage.
    return [t("acs.shareLead", { building: c.buildingText, listingType: listingType(c), size: sizeText(c), total: formatInt(c.priceAed), asking: acs.asking }), acsShareSentence(c), t("share.source", { url: c.url })].join(" ");
  }
  const parts = [t(v === "inline" ? "share.textInline" : v ? "share.text" : thin, vars)];
  const recent = recentShown(c);
  if (recent) parts.push(t("share.recent", { median: formatInt(recent.medianPsf as number), count: recent.count }));
  // Too few sales: the range of adjusted registered sales when it shows, else the second tier's.
  const similar = acs ? acsShareSentence(c) : similarShare(c);
  if (similar) parts.push(similar);
  parts.push(t("share.source", { url: c.url }));
  return parts.join(" ");
}

/**
 * c.ogTitle with no branding (RESULT_SPEC section 8.3): "Aykon City Tower C 2-bed: in line with
 * registered sales (+1.4%)", "… 15.4% above registered sales". c.ogTitleThin / c.ogTitleNone without a
 * verdict.
 */
export function ogTitle(c: CheckView): string {
  const v = verdictOf(c);
  const near = nearbyShown(c);
  if (near) {
    // "Marlow House 2-bed: above the range of nearby sales".
    const head: string = COPY[NEARBY_HEAD[near.verdict]];
    return t("c.ogTitle", { building: c.buildingText, bedType: bedsLabel(c.bedrooms), verdictPhrase: head[0].toLowerCase() + head.slice(1) });
  }
  const lead = acsLead(c);
  if (lead) {
    // "Test Tower D 2-bed: within the range of adjusted sales".
    const head: string = COPY[ACS_HEAD[lead.verdict]];
    return t("c.ogTitle", { building: c.buildingText, bedType: bedsLabel(c.bedrooms), verdictPhrase: head[0].toLowerCase() + head.slice(1) });
  }
  if (v) {
    const diff = c.analysis.diff as number;
    const verdictPhrase =
      v === "inline"
        ? t("c.ogVerdictInline", { figure: formatPct(diff) })
        : t(v === "above" ? "c.ogVerdictAbove" : "c.ogVerdictBelow", { pct: formatPctNumber(diff) });
    return t("c.ogTitle", { building: c.buildingText, bedType: bedsLabel(c.bedrooms), verdictPhrase });
  }
  const vars = { ...verdictVars(c), figure: stampFigure(c) };
  return t(c.analysis.band === "none" ? "c.ogTitleNone" : "c.ogTitleThin", vars);
}

/**
 * c.ogDescLive: "43 registered sales in 12 months. Recent sales lower. Not a valuation."; c.ogDescNone
 * for a not-covered comparison (no count: it would read as "0 sales").
 */
export function ogDescription(c: CheckView): string {
  const near = nearbyShown(c);
  const nearVars = nearbyRange(c);
  if (near && nearVars) return t(near.kind === "in" ? "nearby.ogDescIn" : "nearby.ogDescOut", nearVars);
  const acs = acsRange(c);
  if (acs) return t("acs.ogDesc", acs);
  const range = similarRange(c);
  const project = similarProject(c);
  if (range && project) return t("similar.projectOgDesc", { ...range, project });
  if (range) return t("similar.ogDesc", range);
  if (c.analysis.band === "none") return COPY["c.ogDescNone"];
  const recent = recentShown(c);
  const recentShort = recent ? `${COPY[recent.direction === "lower" ? "c.ogRecentLower" : "c.ogRecentHigher"]} ` : "";
  return t("c.ogDescLive", { count: c.analysis.count, months: windowMonths(c.rules.windowDays), recentShort });
}

/** c.ogAlt (c.ogAltThin / c.ogAltNone without a verdict). */
export function ogAlt(c: CheckView): string {
  const vars = { ...verdictVars(c), figure: stampFigure(c) };
  const nearVars = nearbyRange(c);
  if (nearVars) return t("nearby.ogAlt", nearVars);
  const acs = acsRange(c);
  if (acs && verdictOf(c)) return t("acs.ogAlt", acs);
  if (verdictOf(c)) return t("c.ogAlt", vars);
  const alt = t(c.analysis.band === "none" ? "c.ogAltNone" : "c.ogAltThin", vars);
  if (acs) return `${alt.replace(/\.?$/, ".")} ${t("acs.ogAlt", acs)}`;
  const range = similarRange(c);
  const project = similarProject(c);
  if (range && project) return `${alt.replace(/\.?$/, ".")} ${t("similar.projectOgAlt", { ...range, project })}`;
  return range ? `${alt.replace(/\.?$/, ".")} ${t("similar.ogAlt", range)}` : alt;
}

/** The share card's text alternative (card.alt, card.altThin), or null when there is no card (not covered). */
export function cardAlt(c: CheckView): string | null {
  const a = c.analysis;
  const nearVars = nearbyRange(c);
  if (nearVars) {
    return t("nearby.cardAlt", { ...nearVars, building: c.buildingText, listingType: listingType(c), size: sizeText(c), total: formatInt(c.priceAed), verdict: verdictHeadText(c) });
  }
  if (a.band === "none") return null;
  const vars = {
    ...verdictVars(c),
    building: c.buildingText,
    listingType: listingType(c),
    size: sizeText(c),
    verdict: verdictHeadText(c),
  };
  const acs = acsRange(c);
  if (acs && verdictOf(c)) {
    return t("acs.cardAlt", { ...acs, building: c.buildingText, listingType: listingType(c), size: sizeText(c), total: formatInt(c.priceAed), verdict: verdictHeadText(c) });
  }
  const alt = t(verdictOf(c) ? "card.alt" : "card.altThin", vars);
  if (acs) return `${alt.replace(/\.?$/, ".")} ${t("acs.ogAlt", acs)}`;
  const range = similarRange(c);
  return range ? `${alt.replace(/\.?$/, ".")} ${t("similar.ogAlt", range)}` : alt;
}

/** The band badge label (band.*). */
export function bandLabel(band: CheckView["analysis"]["band"]): string {
  return COPY[`band.${band}`];
}

/** share.fileName from the listing's own building text: "fairsquare-aykon-city-tower-c-FYZ79D.png". */
export function shareFileName(c: Pick<CheckView, "buildingText" | "code">): string {
  return t("share.fileName", { "building-slug": slugify(c.buildingText), code: c.code });
}

/** cost.row: "About AED 10,618 a month with 20% down". */
export function costRow(monthlyAed: number, downPct: number): string {
  return t("cost.row", { monthly: formatInt(monthlyAed), down: downPct });
}

// ---------- the similar-buildings comparison (DESIGN.md section 6.16, REAL_DATA.md section 15) ----------

/** The strings of a shown similar-buildings comparison, in reading order. */
export interface SimilarLines {
  /** `similar.h`. */
  heading: string;
  /** "Within the range" | "Above the range" | "Below the range". */
  head: string;
  /** "Narrow range" | "Broad range". */
  tier: string;
  intro: string;
  /** The range sentence: where the building's own median sits. Never one figure. */
  range: string;
  /** The asking price against the range. */
  verdict: string;
  /** What the range is built from, with every count. */
  sources: string;
  /** How far apart the other buildings' medians are (`similar.srcSpan`); null with fewer than two, or for an entry stored without it. */
  span: string | null;
  /** Why this is weaker evidence, ending "Not a valuation." */
  weaker: string;
  /** What the tests found; null for an entry stored without it. */
  tested: string | null;
  limits: string;
  /** The project route only: why the range reaches further up than down (`similar.projectReach`); null otherwise. */
  reach: string | null;
  /** For the live region, after the too-few sentence: the intro, the range and the verdict as one string. */
  announce: string;
}

function joinList(parts: readonly string[]): string {
  if (parts.length <= 1) return parts.join("");
  return `${parts.slice(0, -1).join(", ")} ${COPY["similar.and"]} ${parts[parts.length - 1]}`;
}

/**
 * The second tier's copy for a comparison, or null when there is none to show (`similar` absent, not
 * shown, without its range, or resting on nothing but the 12 months' own sales: `shownSimilar`): the
 * page then keeps "Too few sales to compare yet" or "Not covered yet" as it is. Every sentence comes
 * from the stored entry, so /c reads the same later.
 */
export function similarLines(c: Pick<CheckView, "similar" | "bedrooms" | "building" | "buildingText" | "analysis" | "rules">): SimilarLines | null {
  const s = shownSimilar(c.similar);
  if (!s) return null;
  const { months, minSales } = ruleVars(c.rules);
  const basis = basisWord(c.analysis.completionBasis);
  const bedTypePlural = bedsLabelPlural(c.bedrooms);
  if (s.scenario === "project" && s.project) return projectLines(c, s, { months, basis, bedTypePlural, project: s.project.name });
  const parts: string[] = [];
  if (s.evidence.ownSales > 0) parts.push(tPlural("similar.srcOwn", s.evidence.ownSales, { n: formatInt(s.evidence.ownSales), months }));
  if (s.evidence.olderSales > 0) {
    parts.push(tPlural("similar.srcOlder", s.evidence.olderSales, { n: formatInt(s.evidence.olderSales), from: formatDate(addDays(s.windowEnd, -1095)) }));
  }
  if (s.evidence.otherBedroomSales > 0) parts.push(tPlural("similar.srcOtherBeds", s.evidence.otherBedroomSales, { n: formatInt(s.evidence.otherBedroomSales) }));
  const usesOthers = similarReadsOthers(s);
  if (usesOthers) {
    const place = similarPlace(s);
    parts.push(tPlural("similar.srcRef", s.comparableBuildings, { n: formatInt(s.comparableSales), k: formatInt(s.comparableBuildings), basis, bedTypePlural, place }));
  }
  const head = COPY[s.verdict === "above" ? "similar.headAbove" : s.verdict === "below" ? "similar.headBelow" : "similar.headWithin"];
  const range = t("similar.range", {
    low: formatInt(s.rangeLowPsf),
    high: formatInt(s.rangeHighPsf),
    basis,
    bedTypePlural,
    building: buildingLabel(c),
    months,
    to: formatDate(s.windowEnd),
  });
  const verdict = t(s.verdict === "above" ? "similar.above" : s.verdict === "below" ? "similar.below" : "similar.within", { asking: formatInt(c.analysis.askingPsf) });
  return {
    heading: COPY["similar.h"],
    head,
    tier: COPY[s.tier === "close" ? "similar.tierClose" : "similar.tierBroad"],
    intro: COPY["similar.intro"],
    range,
    verdict,
    sources: t("similar.sources", { list: joinList(parts) }),
    span:
      usesOthers && s.comparableBuildings > 1 && s.comparableSpan
        ? t("similar.srcSpan", { lo: formatInt(s.comparableSpan.lowPsf), hi: formatInt(s.comparableSpan.highPsf) })
        : null,
    weaker: usesOthers ? COPY["similar.weaker"] : t("similar.weakerOwn", { minSales, months }),
    tested: s.tested ? t("similar.tested", { held: s.tested.heldOf10, heldLater: s.tested.heldLaterOf10 }) : null,
    limits: COPY["similar.limits"],
    reach: null,
    announce: `${COPY["similar.intro"]} ${range} ${verdict}`,
  };
}

/** The project route's sentences (REAL_DATA.md section 15.8): other buildings of the project only, and the building has no sales. */
function projectLines(
  c: Pick<CheckView, "analysis">,
  s: NonNullable<ReturnType<typeof shownSimilar>>,
  v: { months: number | string; basis: string; bedTypePlural: string; project: string },
): SimilarLines {
  const intro = t("similar.projectIntro", { project: v.project });
  const range = t("similar.projectRange", { low: formatInt(s.rangeLowPsf), high: formatInt(s.rangeHighPsf), basis: v.basis, bedTypePlural: v.bedTypePlural, months: v.months, to: formatDate(s.windowEnd) });
  const verdict = t(s.verdict === "above" ? "similar.above" : s.verdict === "below" ? "similar.below" : "similar.within", { asking: formatInt(c.analysis.askingPsf) });
  return {
    heading: t("similar.projectH", { project: v.project }),
    head: COPY[s.verdict === "above" ? "similar.headAbove" : s.verdict === "below" ? "similar.headBelow" : "similar.headWithin"],
    tier: COPY[s.tier === "close" ? "similar.tierClose" : "similar.tierBroad"],
    intro,
    range,
    verdict,
    sources: tPlural("similar.projectSrc", s.comparableBuildings, { n: formatInt(s.comparableSales), k: formatInt(s.comparableBuildings), basis: v.basis, bedTypePlural: v.bedTypePlural, project: v.project }),
    span: s.comparableBuildings > 1 && s.comparableSpan ? t("similar.srcSpan", { lo: formatInt(s.comparableSpan.lowPsf), hi: formatInt(s.comparableSpan.highPsf) }) : null,
    weaker: COPY["similar.projectWeaker"],
    tested: s.tested ? t("similar.projectTested", { held: s.tested.heldOf10 }) : null,
    limits: COPY["similar.limits"],
    reach: COPY["similar.projectReach"],
    announce: `${intro} ${range} ${verdict}`,
  };
}

/** The project the range was read from, when it is the project route; else null. */
export function similarProject(c: Pick<CheckView, "similar">): string | null {
  const s = shownSimilar(c.similar);
  return s && s.scenario === "project" && s.project ? s.project.name : null;
}
/** The figures of a shown range as copy variables ("1,720", "1,980", "within"), or null when none shows. */
export function similarRange(c: Pick<CheckView, "similar" | "analysis">): { low: string; high: string; asking: string; position: string } | null {
  const s = shownSimilar(c.similar);
  if (!s) return null;
  return {
    low: formatInt(s.rangeLowPsf),
    high: formatInt(s.rangeHighPsf),
    asking: formatInt(c.analysis.askingPsf),
    position: COPY[s.verdict === "above" ? "similar.posAbove" : s.verdict === "below" ? "similar.posBelow" : "similar.posWithin"],
  };
}

/** True when a shown range read other buildings (false: it rests on this building's own sales over three years). */
export function similarUsesOthers(c: Pick<CheckView, "similar">): boolean {
  return !!c.similar && similarReadsOthers(c.similar);
}

/** Where the other buildings are: "of the same project", "in Dubai Marina", "in the same area". */
function similarPlace(s: Pick<SimilarView, "level" | "place">): string {
  return s.level === "project" ? COPY["similar.placeProject"] : s.place ? t("similar.placeNamed", { place: s.place }) : COPY["similar.placeArea"];
}

/** The share text's sentence for a shown range (similar.share), or null. */
function similarShare(c: CheckView): string | null {
  const range = similarRange(c);
  if (!range) return null;
  return t("similar.share", {
    ...range,
    where: c.similar && similarUsesOthers(c) ? t("similar.shareWhereOthers", { place: similarPlace(c.similar) }) : COPY["similar.shareWhereOwn"],
    minSales: c.rules.minSales,
  });
}
// ---------- adjusted registered sales: the sentences (DESIGN.md section 6.17, REAL_DATA.md section 16) ----------

/** The strings of a shown range of adjusted registered sales, in reading order. */
export interface AcsLines {
  /** `acs.h`. */
  heading: string;
  /** "Within the range of adjusted sales" | "Above ..." | "Below ...". */
  head: string;
  /** Too few sales only: why three years of sales are read (`acs.fewLead`); null when the range leads. */
  fewLead: string | null;
  /** What was taken and what each sale was adjusted to. */
  intro: string;
  /** The range sentence. Never one figure. */
  range: string;
  /** The asking price against the range. */
  verdict: string;
  /** The asking price is past every adjusted sale used: "It is higher than all 12 adjusted sales; the highest is AED 1,786 per sq ft."; else null. */
  beyond: string | null;
  /** Beside `beyond` when the outcome is still "within": why the range reaches further than the sales (`acs.beyondWithin`). */
  beyondWhy: string | null;
  /** Sales of other bedroom types count for more than the building's own of this type (`acs.leadOtherBeds`); else null. */
  otherBeds: string | null;
  /** The same-building median beside the range (`acs.medianLine`); null without one. */
  median: string | null;
  /** What the range is built from, with every count and the dates the sales run between. */
  sources: string;
  /** "In tests, about 8 of 10 later sale prices were inside a range made this way."; null for an entry stored without it. */
  testedShort: string | null;
  /** "DLD building: {dld}." so a wrong match shows. */
  dld: string;
  /** What is adjusted and what is not, ending "Not a valuation." */
  limits: string;
  /** The definitions behind "How the sales were adjusted": date, size, how much a sale counts, the test, the limits. */
  definitions: string[];
  /** For the live region, after the too-few sentence: the intro, the range and the outcome as one string. */
  announce: string;
}

/**
 * The copy of a shown range of adjusted registered sales, or null when none shows (`acsShown`): the
 * page then reads exactly as it did. Every sentence comes from the stored entry, so /c reads the same
 * later.
 */
export function acsLines(c: Pick<CheckView, "acs" | "analysis" | "building" | "buildingText" | "bedrooms" | "sizeSqft" | "rules">): AcsLines | null {
  const a = acsShown(c);
  if (!a) return null;
  const { months, minSales } = ruleVars(c.rules);
  const to = formatDate(a.dataThrough);
  const size = formatInt(c.sizeSqft);
  const n = formatInt(a.evidence.sales);
  const parts: string[] = [];
  if (a.evidence.ownSales > 0) parts.push(tPlural("acs.srcOwn", a.evidence.ownSales, { n: formatInt(a.evidence.ownSales), bedTypePlural: bedsLabelPlural(c.bedrooms) }));
  if (a.evidence.otherBedroomSales > 0) parts.push(tPlural("acs.srcOtherBeds", a.evidence.otherBedroomSales, { n: formatInt(a.evidence.otherBedroomSales) }));
  if (a.evidence.projectSales > 0) parts.push(tPlural("acs.srcProject", a.evidence.projectSales, { n: formatInt(a.evidence.projectSales) }));
  const { from, last, complete } = acsDates(a);
  const list = parts.length <= 1 ? parts.join("") : `${parts.slice(0, -1).join(", ")} ${COPY["acs.and"]} ${parts[parts.length - 1]}`;
  const lead = verdictOf(c) !== null;
  const project = a.evidence.projectSales > 0;
  const intro = t(project ? "acs.introProject" : "acs.intro", { n, building: buildingLabel(c), to, size });
  const range = t("acs.range", { low: formatInt(a.rangeLowPsf), high: formatInt(a.rangeHighPsf) });
  const verdict = t(ACS_SENTENCE[a.verdict], { asking: formatInt(c.analysis.askingPsf) });
  // The plainest fact on the page: the asking price past every adjusted sale used. Whole AED, as printed; only when every row is listed.
  const asking = Math.round(c.analysis.askingPsf);
  const adjusted = a.comparables.map((r) => Math.round(r.adjustedPsf));
  const top = Math.max(...adjusted);
  const bottom = Math.min(...adjusted);
  const beyond = !complete ? null : asking > top ? t("acs.beyondHigh", { n, psf: formatInt(top) }) : asking < bottom ? t("acs.beyondLow", { n, psf: formatInt(bottom) }) : null;
  const limits = COPY["acs.limits"];
  const tested = a.tested ? t("acs.tested", { held: a.tested.heldOf10 }) : null;
  return {
    heading: COPY["acs.h"],
    head: COPY[ACS_HEAD[a.verdict]],
    fewLead: lead ? null : t(project ? "acs.fewLeadProject" : "acs.fewLead", { minSales, months }),
    intro,
    range,
    verdict,
    beyond,
    beyondWhy: beyond && a.verdict === "within" ? COPY["acs.beyondWithin"] : null,
    // The stored evidence class: 2 when sales of other bedroom types carry more than the building's own of this type.
    otherBeds: a.evidence.lead === 2 ? t("acs.leadOtherBeds", { bedTypePlural: bedsLabelPlural(c.bedrooms) }) : null,
    median: lead && c.analysis.medianPsf !== null ? t("acs.medianLine", { count: c.analysis.count, months, median: formatInt(c.analysis.medianPsf) }) : null,
    sources: t("acs.sources", { list, from: formatDate(from), to: formatDate(last) }),
    testedShort: a.tested ? t("acs.testedShort", { held: a.tested.heldOf10 }) : null,
    dld: t("acs.dld", { dld: buildingLabel(c) }),
    limits,
    definitions: [t("acs.howDate", { to }), t("acs.howSize", { size }), COPY["acs.howWeight"], tested, limits].filter((s): s is string => s !== null),
    announce: [intro, range, verdict, beyond].filter(Boolean).join(" "),
  };
}

// ---------- nearby registered sales: the last resort (DESIGN.md section 6.18, REAL_DATA.md section 17) ----------

type NearbyCheck = Pick<CheckView, "analysis"> & Partial<Pick<CheckView, "acs" | "building" | "similar" | "nearby">>;

/**
 * The range of nearby registered sales a comparison shows, or null. It is the last resort: never
 * beside a verdict, never beside a range of adjusted registered sales or of the second tier, and only
 * when the stored entry is safe to draw (`shownNearby`) and is of the kind the comparison is ("in": a
 * building was chosen; "out": none was). Null means the page is exactly what it was.
 */
export function nearbyShown(c: NearbyCheck): ShownNearby | null {
  const band = c.analysis.band;
  if (band !== "thin" && band !== "none") return null;
  const n = shownNearby(c.nearby);
  if (!n) return null;
  if (n.kind === "in" ? !c.building || band !== "thin" : !!c.building || band !== "none") return null;
  if (acsShown(c) || shownSimilar(c.similar)) return null;
  return n;
}

/** True for a not-covered comparison with nothing to show: no card, no stamp, no Save (a nearby range changes that). */
export function plainNotCovered(c: NearbyCheck): boolean {
  return c.analysis.band === "none" && !nearbyShown(c);
}

type NearbyVerdictWord = ShownNearby["verdict"];
const NEARBY_HEAD = { within: "nearby.headWithin", above: "nearby.headAbove", below: "nearby.headBelow" } as const;
const NEARBY_POS = { within: "nearby.posWithin", above: "nearby.posAbove", below: "nearby.posBelow" } as const;
const NEARBY_SENTENCE = { within: "nearby.within", above: "nearby.above", below: "nearby.below" } as const;

/** The headline in its two parts: "Above the range" (the outcome's hue) and "of nearby sales" (ink). */
export function nearbyHead(verdict: NearbyVerdictWord): { figure: string; rest: string } {
  const full: string = COPY[NEARBY_HEAD[verdict]];
  const rest: string = COPY["nearby.headRest"];
  return full.endsWith(` ${rest}`) ? { figure: full.slice(0, -rest.length - 1), rest } : { figure: full, rest: "" };
}

/** "within" | "above" | "below", as the sentences and the Saved line word it. */
export function nearbyPosition(verdict: NearbyVerdictWord): string {
  return COPY[NEARBY_POS[verdict]];
}

/** Where the other buildings are, named: the community, the community and the rest of its area, or the area. */
export function nearbyPlace(n: Pick<NearbyView, "scope" | "community" | "area">): string {
  if (n.scope === "area") return n.area ?? "";
  if (n.scope === "community_and_area" && n.community && n.area && n.area !== n.community) return t("nearby.placeBoth", { community: n.community, area: n.area });
  return n.community ?? n.area ?? "";
}

/** The figures of a shown range as copy variables, or null. `n` sales in `k` buildings in `place`. */
export function nearbyRange(c: NearbyCheck): { low: string; high: string; asking: string; position: string; n: string; k: string; place: string } | null {
  const n = nearbyShown(c);
  if (!n) return null;
  return {
    low: formatInt(n.rangeLowPsf),
    high: formatInt(n.rangeHighPsf),
    asking: formatInt(c.analysis.askingPsf),
    position: nearbyPosition(n.verdict),
    n: formatInt(n.comparablesTotal),
    k: formatInt(n.buildingsTotal),
    place: nearbyPlace(n),
  };
}

/** The strings of a shown range of nearby registered sales, in reading order. */
export interface NearbyLines {
  /** "Above the range of nearby sales". */
  head: string;
  /** What the building itself has: no sales, too few, or not found in DLD data. */
  own: string;
  /** "The range here comes from other buildings in {place}, not from this one." */
  fromOthers: string;
  /** What was taken and what each sale was adjusted to. */
  intro: string;
  /** The range sentence. Never one figure. */
  range: string;
  /** The asking price against the range. */
  verdict: string;
  /** The weakness note, always shown: other buildings, and the tested share. */
  weak: string;
  tested: string;
  /** Kind "out" only: the building was not found and may be registered under another name; else null. */
  weakOut: string | null;
  /** Kind "in": "DLD building: {dld}."; null for a building that is not in the data. */
  dld: string | null;
  notValuation: string;
  /** The definitions behind "How the sales were adjusted". */
  definitions: string[];
  /** For the live region: everything above the weakness note as one string. */
  announce: string;
}

/**
 * The copy of a shown range of nearby registered sales, or null when none shows (`nearbyShown`): the
 * page then reads exactly as it did. Every sentence comes from the stored entry, so /c reads the same later.
 */
export function nearbyLines(c: Pick<CheckView, "analysis" | "bedrooms" | "sizeSqft" | "rules" | "buildingText"> & Partial<Pick<CheckView, "acs" | "building" | "similar" | "nearby">>): NearbyLines | null {
  const n = nearbyShown(c);
  const vars = nearbyRange(c);
  if (!n || !vars) return null;
  const { months, minSales } = ruleVars(c.rules);
  const basis = basisWord(c.analysis.completionBasis);
  const bedTypePlural = bedsLabelPlural(c.bedrooms);
  const to = formatDate(n.dataThrough);
  const size = formatInt(c.sizeSqft);
  const windowTo = formatDate(c.analysis.windowEnd);
  const own =
    n.kind === "out"
      ? t("nearby.ownOut", { building: c.buildingText })
      : c.analysis.count === 0
        ? t("nearby.ownNone", { building: buildingLabel(c as Pick<CheckView, "building" | "buildingText">), basis, bedTypePlural, months, to: windowTo })
        : tPlural("nearby.ownFew", c.analysis.count, { building: buildingLabel(c as Pick<CheckView, "building" | "buildingText">), count: c.analysis.count, basis, bedTypePlural, months, to: windowTo, minSales });
  const fromOthers = t("nearby.fromOthers", { place: vars.place });
  const intro = t(n.ageAdjusted ? "nearby.introAge" : "nearby.intro", { n: vars.n, k: vars.k, basis, bedTypePlural, place: vars.place, to, size });
  const range = t("nearby.range", { low: vars.low, high: vars.high });
  const verdict = t(NEARBY_SENTENCE[n.verdict], { asking: vars.asking });
  const head: string = COPY[NEARBY_HEAD[n.verdict]];
  const limits = COPY["nearby.limits"];
  const tested = t("nearby.tested", { held: n.tested.heldOf10 });
  const age = n.ageAdjusted ? COPY[n.kind === "in" ? "nearby.howAge" : "nearby.howAgeNew"] : COPY["nearby.howAgeNone"];
  return {
    head,
    own,
    fromOthers,
    intro,
    range,
    verdict,
    weak: COPY["nearby.weak"],
    tested,
    weakOut: n.kind === "out" ? COPY["nearby.weakOut"] : null,
    dld: n.kind === "in" && c.building ? t("nearby.dld", { dld: c.building.name }) : null,
    notValuation: COPY["nearby.notValuation"],
    definitions: [
      t("nearby.howDate", { to }),
      t("nearby.howSize", { size }),
      age,
      COPY["nearby.howWeight"],
      n.scope === "community_and_area" && n.community ? t("nearby.howArea", { community: n.community }) : null,
      n.kind === "in" ? COPY["nearby.howOwn"] : null,
      tested,
      limits,
    ].filter((s): s is string => s !== null),
    announce: [`${head}.`, own, fromOthers, range, verdict].join(" "),
  };
}

/** The dates the registered sales used run between: the earliest and the latest sale listed, or the whole window when the list is cut. */
export function nearbyDates(n: ShownNearby): { from: IsoDate; last: IsoDate } {
  const complete = n.comparables.length >= n.comparablesTotal;
  const dates = n.comparables.map((r) => r.date).sort();
  return complete && dates.length ? { from: dates[0], last: dates[dates.length - 1] } : { from: n.windowFrom, last: n.dataThrough };
}
