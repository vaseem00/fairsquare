# Fairsquare redesign: the balance and the stamp

Renamed from Mizan to Fairsquare on 18 Nov 2026. Internal identifiers (storage keys, folders, the Railway service, the repo) keep the old name. The Arabic name, its footer gloss and the Markazi Text font were retired with the old name, so the wordmark is English only.

Status: ready for build. Date: 18 Nov 2026. Owner: design lead.
Branch: `real-data` at 5ea44a3.

This file overrides the visual and flow parts of `docs/DESIGN.md`: sections 1.2, 2 (tokens), 3 (pages), 4.2 (Magic UI), 5.1 (loading) and 7.2 (focus plan). Where the two disagree, this file wins. These stay in force unchanged: `docs/REAL_DATA.md` (data rules), `docs/ARCHITECTURE.md` (API), DESIGN.md section 8 (stamp geometry, card canvas, OG image) and the copy rules in DESIGN.md section 6. The copy deck stays in DESIGN.md section 6, because `tests/unit/copy.test.ts` reads it there. Section 9 of this file lists the rows to add and remove.

Contents

0. Decision
1. Principles and anti-slop rules
2. Typography
3. Colour
4. Space, radius, borders, elevation, icons
5. Motion system
6. The flow: states, decisions, URLs, API calls
7. The processing scene
8. Screens
9. Copy changes
10. What to delete, add and edit
11. Tests
12. Acceptance checklist
13. Risks and owner sign-offs
14. Review changes (after the first build)

---

## 0. Decision

**Winner: "The Balance" (direction 2), cut down, with grafts from "Folio" (direction 1) and "Quiet Instrument" (direction 3).**

The owner asked for loading to become "a visual decoration". The balance answers that best. The logo mark already is a balance inside a stamp frame. So the scene brings the logo to life. The balance weighs the listing against registered sales. Then the stamp lands on the person's screenshot. There are two brand objects, the instrument and the stamp. There is one idea: weigh, then stamp.

What we take from each direction:

| From | Kept | Dropped |
|---|---|---|
| The Balance | The hairline balance as the loading state. The screenshot sits on the left pan and sales dots drop on the right pan. Outlier dots turn hollow. The tilt shows the real diff, clamped to ±30%, drawn as at most ±9°. The beam tips toward the pan when you drag a file over it on desktop. | The tilted glyph in front of the headline. The scene shrinking to a strip for questions. The screenshot condensing into a diamond. A balance above the CTA on the phone home. Allowing middle dots in copy (copy.test.ts bans `·`). The dial and the hatched band. |
| Folio | Newsreader for words and Archivo for tools. The "two inks" palette rule. Verdict colour only on the figure words. Notices as left-ruled lines. The read line with Edit, whose figures set in with an ink underline. A reserved head slot, so nothing shifts. One stage slot that becomes the stamped sheet. Failures drawn in pencil. The text-safe zone on the plate. Text-only buttons. | Crop marks, the 4-tick stage rule and the image pan (a second metaphor). Italic. |
| Quiet Instrument | A pure `decideNext()` and a `sceneStage()` selector with unit tests. Question order: outcome, bedrooms, size, price, building. The price-per-sq-ft question. The match is a `GET` request. The `?step=compare` URL, replaced by the result. Stamp fonts start loading when the scene starts. The extra sentence for reduced motion. Markazi Text for the Arabic wordmark (later retired with the rename, see the note at the top). Short serif failure titles. | The HTML instrument that morphs into the dot chart. The 4:3 window centred on the stamp. A ledger of blank rules while reading. |

Scores are in the structured output of this run. In short: the balance scores highest on brand fit and on the scene, Folio on simplicity and accessibility, Quiet Instrument on meaning, but lowest on buildability.

---

## 1. Principles and anti-slop rules

### 1.1 Principles

1. **Words, one instrument, one stamp.** Each screen has one typographic hierarchy and at most one drawn object: the balance or the stamped sheet. Everything else is type on paper.
2. **Motion means work.** The balance moves only while Fairsquare works, and it settles on the real answer. The stamp lands because a comparison exists. Controls respond to presses. Nothing else moves.
3. **No form after a read.** A clean read goes straight to the verdict. Fairsquare asks one question at a time, and only when it must. The form exists only behind Edit and for typed entry.
4. **Evidence next to the claim.** The verdict sits beside its count, median, window, source and licence. The read line shows what Fairsquare read. The sales list is never behind an ask.
5. **Never wait for decoration.** Requests fire at once. The only hold is a 400ms beat to show what was read. The settle-and-stamp moment takes 900ms or less. Any tap, key, scroll or wheel skips to the end.

### 1.2 Anti-slop rules (review against these)

Do:

- Use one serif voice (Newsreader) and one grotesk tool face (Archivo). Use large display sizes with tight leading, and left-align everything.
- Use two inks on paper: blue-black ink for text and controls, and indigo for the stamp and its markers only.
- Separate content with hairlines and whitespace.
- Use one primary action per screen. Secondary actions are underlined text buttons.
- Make every number real: the person's listing or registered sales.

Never:

- Inter or a system-only stack. Purple, teal or mint SaaS hues. Gradients, blobs, mesh, glass or blur.
- Glowing borders, border-beam, shimmer, sparkles, skeleton pulses or typing effects.
- Numbered "How it works" steps, steppers or "Step x of 3".
- Icon-in-a-square feature grids, or icons inside buttons.
- Pills or badges on public pages.
- Cards in cards, or a box around a group.
- A centred hero with two equal buttons.
- Emoji, tracked caps (except inside the stamp), or italic accent words.
- Section entrances, scroll reveals, hover lifts, parallax or count-up numbers on public pages.
- Drop shadows on anything except the document (the screenshot sheet or plate) and overlays.

Evidence of the current slop is in the review's screenshots: `01-home-*` (heavy wide grotesk h1, teal buttons, numbered How it works, boxed alert), `02a-details-*` (the auto-filled form with a "Best match" pill, and an action bar covering an option), `02-result-*` (stepper, band pill, the same fact four times, icon buttons) and `06-coverage-*` (a column of pills). `04b-stale-result-1280-light.png` shows the stamp printed over the plate text.

---

## 2. Typography

### 2.1 Families (all self-hosted by next/font at build time; the nonce CSP is unchanged)

`src/app/fonts.ts`:

```ts
import { Archivo, Newsreader } from "next/font/google";

/** The voice: display, headings, the verdict, sentences, prose. Roman only (no italic is loaded). */
export const newsreader = Newsreader({
  subsets: ["latin"],
  axes: ["opsz"], // wght is variable by default (200-800); opsz 6-72
  display: "swap",
  variable: "--font-newsreader",
});

/** The tools: buttons, inputs, labels, nav, tables, captions, figures, admin. Unchanged. */
export const archivo = Archivo({
  subsets: ["latin"],
  axes: ["wdth"],
  display: "swap",
  variable: "--font-archivo",
});
```

- `src/app/layout.tsx`: `<html className={`${archivo.variable} ${newsreader.variable}`}>`.
- Do not pass `style: ["normal", "italic"]`. The next/font docs allow a style array only for non-variable Google fonts, and the design uses no italic.
- Leave `font-optical-sizing: auto`, so opsz follows the px size: about 72 at display sizes and 17-20 in sentences. Never set opsz by hand.
- Stamp faces do not change: "Mizan Stamp Condensed" and "Mizan Stamp Wide" in `public/fonts`, with `font-display: block`. When a scene starts, call `document.fonts.load('780 16px "Mizan Stamp Condensed"')` and the same for Wide, so the stamp can land on time.
- Font budget: Newsreader roman variable plus Archivo variable, latin only, at most 230 KB woff2. Measure it in the first build.

`@theme inline` in `globals.css`:

```css
--font-sans: var(--font-archivo), ui-sans-serif, system-ui, sans-serif;           /* unchanged */
--font-display: var(--font-newsreader), "Iowan Old Style", "Palatino Linotype", Georgia, serif;
--font-heading: var(--font-display);
```

### 2.2 Roles

| Face | Used for | Never for |
|---|---|---|
| Newsreader | The home h1. Scene captions and questions. Verdict headlines. Page h1 and h2. The verdict sentence. The read line. The From the data sentence. Prose on How Fairsquare compares and Privacy. The wordmark "Fairsquare". Candidate building names. | Buttons, inputs, labels, nav, tables, captions, attribution. Anything below 16px. |
| Archivo | Everything you operate. Labels, captions, helper text, tables, the sales list, cost figures, coverage counts, scene pan labels, attribution, footer, admin. | Headlines on public pages. |

### 2.3 Type scale

The public type utilities go into `globals.css` as `@utility type-*`, each with its own breakpoints. The existing `--text-*` tokens (caption 14 to display 48) stay for Archivo UI and admin.

| Utility | Phone (<768) | Tablet (768-1023) | Desktop (>=1024) | Face, weight, tracking |
|---|---|---|---|---|
| `type-display-xl` (home h1) | 44/1.0 | 64/0.98 | 88/0.95 | Newsreader 460, -0.02em (desktop -0.025em) |
| `type-display-lg` (verdict, /c verdict) | 40/1.05 | 52/1.02 | 64/1.0 | Newsreader 520, -0.015em |
| `type-display-md` (scene caption, question, failure title, page h1) | 30/1.12 | 36/1.1 | 44/1.08 | Newsreader 480, -0.01em |
| `type-heading` (h2) | 24/1.2 | 26/1.2 | 28/1.2 | Newsreader 560 |
| `type-title` (h3, building names, disclosure titles) | 20/1.3 | 20/1.3 | 21/1.3 | Newsreader 560 |
| `type-statement` (From the data sentence) | 21/1.4 | 22/1.4 | 24/1.35 | Newsreader 400 |
| `type-lead` (home lead, verdict sentence, read line, question notes) | 18/1.5 | 19/1.5 | 20/1.5 | Newsreader 400 |
| `type-prose` (How Fairsquare compares, Privacy) | 18/1.6 | 18/1.6 | 18/1.6 | Newsreader 400, max 62ch |
| `text-body` (UI) | 16/1.55 | same | same | Archivo 400; buttons 500 |
| label | 14/1.4 | same | same | Archivo 500, ink, sentence case |
| `text-caption` | 14/1.45 | same | same | Archivo 400, muted |
| figure (scene labels, cost) | 17/1.3 | same | 19/1.3 | Archivo 500, wdth 88, tabular |

Rules:

- Nothing in the DOM is smaller than 14px. Nothing in Newsreader is smaller than 16px.
- Headings use `text-wrap: balance` and paragraphs use `text-wrap: pretty`.
- Measure: 34ch for the phone lead, 30ch for the desktop deck, 52ch for the verdict sentence, 62ch for prose.
- Use sentence case. There are no tracked caps outside the stamp, no italic, no drop caps and no mono face.
- Headlines never contain a building name, so the reserved head height holds. The building goes in the sentence below.
- Inputs are always 16px or more.

### 2.4 Numerals

- Newsreader text: `font-variant-numeric: lining-nums proportional-nums` (inside the `type-*` utilities). In the first build, check that Newsreader honours `lnum`. If its default figures are old-style and `lnum` does nothing, wrap figures in sentences in `<span className="num font-sans text-[0.94em]">`.
- Archivo: `@utility num { font-variant-numeric: tabular-nums lining-nums; }`. Apply it to every price, size, count, psf, table date and coverage count.
- Keep the true minus sign (U+2212), en-GB dates ("10 Nov 2026") and AED digit grouping.

### 2.5 Wordmark

- Mark: unchanged (`LogoMark`, the indigo stamp miniature with the balance inside), 28px.
- "Fairsquare": Newsreader 600, 22px, line-height 1, -0.01em, `--foreground`. The `Wordmark` component switches from Archivo wdth 112 to this.
- There is no Arabic name and no gloss, and Markazi Text is not loaded: both were retired with the rename on 18 Nov 2026.

---

## 3. Colour

### 3.1 Rule: two inks on paper

- Blue-black ink carries all text, rules that mean something, controls and sale dots.
- Indigo carries only the stamp, the "this listing" diamond and row bar, and the logo mark.
- Verdict hues colour only the figure words of a verdict.
- Documents (the screenshot, the listing plate, the stamp label) are paper in both themes.
- There is no teal, no gradient and no tinted card.

### 3.2 Tokens

These replace the values in `src/app/globals.css` `:root` and `.dark`. next-themes uses `attribute="class"`, so dark mode is `.dark`. Keep every existing token name so admin and shadcn keep working.

| Token | Light | Dark | Use |
|---|---|---|---|
| `--background` | `#F5F4F0` | `#121317` | Page (paper, night desk) |
| `--foreground`, `--card-foreground`, `--popover-foreground`, `--secondary-foreground`, `--accent-foreground` | `#17191E` | `#ECE9E2` | Ink |
| `--card`, `--popover` | `#FDFCF9` | `#1B1D22` | Inputs, dialogs, drawers |
| `--muted`, `--secondary` | `#ECEAE4` | `#24272D` | Rare fills, the selected bedroom option |
| `--muted-foreground` | `#595C65` | `#A3A6AE` | Pencil: captions, helpers, notes |
| `--accent` | `#E8E5DD` | `#2A2D34` | Hover rows, drag-over |
| `--primary` | `#17191E` | `#ECE9E2` | Ink-filled buttons |
| `--primary-foreground` | `#F5F4F0` | `#121317` | Button text |
| `--primary-hover` (new) | `#2C2F36` | `#D7D3CB` | Primary hover |
| `--border` | `#DEDBD3` | `#2C2F36` | Decorative hairlines only |
| `--input` | `#7A7D85` | `#7A7E87` | Control boundaries, outline buttons, radio rings, hollow tally dots |
| `--ring` | `#17191E` | `#ECE9E2` | 2px focus outline, 2px offset |
| `--stamp` | `#3A37C9` | `#A9A7FF` | Logo mark, diamond, "This listing" bar (UI only) |
| `--verdict-above` | `#8F4A0A` | `#EBA65A` | Sepia |
| `--verdict-inline` | `#17191E` | `#ECE9E2` | Ink (was graphite; section 14) |
| `--verdict-below` | `#1E5B98` | `#86B6EE` | Prussian blue |
| `--notice` | `#F5EACD` | `#3A2D12` | Kept for admin fills; public notices have no fill |
| `--notice-foreground` | `#6B4300` | `#F0C46C` | The notice rule |
| `--destructive` | `#B3261E` | `#F2867E` | Errors |
| `--destructive-foreground` | `#FFFFFF` | `#121317` | |
| `--chart-1` | `#3B5B7A` | `#8FB3D9` | Admin series (steel) |
| `--chart-2` | `#3A37C9` | `#A9A7FF` | Stamp marker |
| `--chart-3` | `#17191E` | `#ECE9E2` | Sale dots, median |
| `--chart-4` | `#E7E4DC` | `#24272D` | The ±5% band fill |
| `--chart-5` | `#8F4A0A` | `#EBA65A` | Admin |
| `--elev-sheet` | `0 0 0 1px rgb(23 25 30/.06), 0 1px 2px rgb(23 25 30/.06), 0 18px 40px -20px rgb(23 25 30/.30)` | `0 0 0 1px rgb(255 255 255/.08)` | The document only |
| `--elev-overlay` | `0 24px 56px -12px rgb(23 25 30/.36)` | `0 0 0 1px rgb(255 255 255/.06), 0 24px 56px -12px rgb(0 0 0/.7)` | Dialogs, drawers |
| `--scrim` | `rgb(18 19 23/.56)` | `rgb(0 0 0/.64)` | |

- Documents keep `PAPER #F6F7F4` and `STAMP_INK #3A37C9` from `src/lib/stamp/geometry.ts`, unchanged, so the canvas card and the OG image do not change.
- The light page (#F5F4F0) is close to the plate's paper. The 1px rim in `--elev-sheet` separates them.
- `layout.tsx` `themeColor`: light `#F5F4F0`, dark `#121317`.

### 3.3 Contrast (WCAG 2, measured with the tokens test formula)

| Pair | Light | Dark |
|---|---|---|
| ink on background / card / accent | 15.98 / 17.14 / 13.97 | 15.31 / 13.91 / 11.37 |
| muted on background / card / muted / accent | 6.07 / 6.51 / 5.55 / 5.31 | 7.62 / 6.92 / 6.15 / 5.66 |
| button text on primary / primary-hover | 15.98 / 12.18 | 15.31 / 12.44 |
| background gap on primary (focus offset) | 15.98 | 15.31 |
| verdict-above on background / card / muted | 6.05 / 6.49 / 5.54 | 8.96 / 8.14 / 7.22 |
| verdict-inline on background / card / muted | 7.58 / 8.13 / 6.93 | 9.44 / 8.57 / 7.61 |
| verdict-below on background / card / muted | 6.35 / 6.81 / 5.81 | 8.79 / 7.98 / 7.08 |
| notice-foreground on notice / background | 7.22 / 7.86 | 8.20 / 11.33 |
| destructive on background / card | 5.94 / 6.37 | 7.50 / 6.81 |
| destructive-foreground on destructive | 6.54 | 7.50 |
| stamp (UI) on background / card / chart-4 | 7.43 / 7.97 / 6.43 | 8.54 / 7.76 / 6.88 |
| input on background / card / accent / muted (3:1 needed) | 3.74 / 4.01 / 3.27 / 3.42 | 4.56 / 4.14 / 3.39 / 3.68 |
| ring on background | 15.98 | 15.31 |
| chart-1 on card / background | 6.91 / 6.44 | 7.72 / 8.50 |
| ink on chart-4 (dots on band) | 13.84 | 12.34 |
| border on background | 1.26 (decorative only) | 1.39 (decorative only) |
| On documents: stamp ink on `#F6F7F4` 7.60. Ink `#17191E` on `#F6F7F4` 16.35. Plate pencil `#53646A` on `#F6F7F4` 5.75. | | |

### 3.4 Verdict colours

- They colour only the figure and direction words at the start of the verdict headline. In "**14.3% above** recent sales", the bold part takes `--verdict-above` and "recent sales" stays ink. In "**In line** with recent sales", "In line" takes `--verdict-inline`, which is ink: a grey there read dimmer than the words after it (section 14).
- Saved rows and the /c "Today" line use the same treatment. The admin verdict chart reuses the three colours.
- Thin ("Too few sales to compare yet") and not covered ("Not covered yet") are plain ink.
- Never use them as a fill, pill, border or background. The direction is always in the words, so colour is never the only cue. The arrow icons and `BandBadge` are removed.
- The scene is monochrome: ink lines, a pencil dimmed state, an indigo diamond.

---

## 4. Space, radius, borders, elevation, icons

- **Grid:** 4px base. Gutters stay as the existing `gutter` utility (16/24/32). Container 1200px of content (`max-w-[1264px]` with the gutters; RESULT_SPEC 3.2). Desktop uses 12 columns with a 24px gap.
- **Section rhythm:** 40px on phones and 64px on desktop between groups. 16-24px inside a group.
- **Radius** (Tailwind `@theme inline`):
  - `--radius-sm` 4px: documents (the sheet, the plate, the scene screenshot).
  - `--radius-md` and `--radius-lg` 6px: controls.
  - `--radius-xl`, `-2xl` and `-3xl` 12px: dialog and drawer top corners.
  - `--radius-4xl` 999px: dots only.
  - The stamped sheet moves from `rounded-xl` to `rounded-sm`.
- **Borders:** `--border` hairlines go between rows and above disclosures, never around a group. Controls use `--input`. There are no bordered cards on public pages.
- **Notices** (stale data, off-plan, size, Claude off, data loading): one paragraph of Archivo 15/1.5 in ink, with a 2px left rule in `--notice-foreground` and 12px left padding. No box, no fill, no icon. `Notice` in `src/components/data/data-notice.tsx` becomes `<p role="note" className="border-l-2 border-notice-foreground pl-3 text-[15px] leading-normal text-foreground">`.
- **Buttons** (Archivo 16/500, no icons):
  - Primary: ink fill, 52px on phones and 48px from 768px, radius 6, padding 0 24px.
  - Secondary: 1px `--input` outline on transparent, the same height.
  - Tertiary: an underlined text button, underline offset 4px, min-height 44px, thickness 1px, 2px on hover.
  - Pressed: background `--primary-hover`. No scale.
  - Keep `focus-visible:ring-offset-2 ring-offset-background` (tokens test).
- **Inputs:** 48px, `--card` fill, 1px `--input` border, radius 6, 16px text, 2px ink focus ring with 2px offset.
- **Elevation:**
  - Level 0: everything.
  - Level 1 (`shadow-sheet`): the document only (stamped sheet, plate, unstamped screenshot sheet).
  - Level 2 (`shadow-overlay` plus scrim): dialogs, drawers, popovers, menus.
  - Sticky bars: opaque `--background`, a 1px top `--border`, no shadow.
- **Icons** (lucide, stroke 1.75): Menu, theme (Sun/Moon/Monitor), X (close), ChevronLeft (Back), ChevronDown (disclosures), ChevronRight (question rows), Search (search inputs), TriangleAlert (field errors), Check (inside "Requested" and copy confirmations). Remove every other icon from buttons and rows: ImageUp, PencilLine, ClipboardPaste, Share2, Bookmark, Expand, Crop, Calculator, CircleHelp, Info on notices, Building2, the arrows.

---

## 5. Motion system

### 5.1 Tokens (`globals.css` and `src/lib/motion.ts`)

| Token | Value | Use |
|---|---|---|
| `--dur-press` | 80ms | Pressed background |
| `--dur-fast` | 140ms | Hover, colour, every exit |
| `--dur-base` | 200ms | Fades, disclosure height, dialog enter, caption swaps |
| `--dur-set` | 220ms | A read figure setting into the read line |
| `--dur-sheet` | 280ms | Drawer and sheet enter (exit 180ms) |
| `--ease-out` | `cubic-bezier(0.2, 0.8, 0.2, 1)` | Arrivals |
| `--ease-in` | `cubic-bezier(0.4, 0, 1, 1)` | Exits |
| `--ease-sway` | `cubic-bezier(0.37, 0, 0.63, 1)` | CSS fallback for the sway |
| `STAMP_SPRING` | `{ stiffness: 700, damping: 32, mass: 0.8 }` | The stamp. Unchanged. |
| `BEAM_SETTLE` | `{ stiffness: 260, damping: 20, mass: 1 }` | Beam to the verdict angle (about 5% overshoot) |
| `BEAM_DIP` | `{ stiffness: 220, damping: 16, mass: 1 }` | The pan dips when the screenshot lands |
| `BEAM_TIP` | `{ stiffness: 300, damping: 22, mass: 1 }` | Desktop drag-over |
| `SWAY_AMP` | `{ stiffness: 170, damping: 26 }` | Sway amplitude changes (about 250ms, no overshoot) |
| `SWAY_PERIOD` | 2400ms | One full sine cycle |
| `SHOW_AFTER` | 300ms | A middle caption ("Finding the building", "Weighing ...") shows only if its request is still pending |
| `READ_HOLD` | 400ms | Shortest time from read/done to the settle, so the read figures are seen |
| `SETTLE_MAX` | 900ms | From the settle start to the stamp at rest |

### 5.2 Where motion is used

- The processing scene: the screenshot lands on the pan, the pan dips, the beam sways (amplitude falls with each stage), dots drop, the beam settles and tilts, the scene dims on failure.
- The settle: caption to verdict crossfade, balance to sheet crossfade, the stamp landing with a 1.5px impact and one 12ms vibration on Android coarse pointers (never on iOS), the phone action bar sliding up, and the rest fading in.
- Read figures setting into the read line.
- Desktop home drag-over: the beam tips -2.5° toward the left pan and the pan rim turns dashed.
- Disclosures, dialogs, drawers, the paste textarea expanding, the pressed state.
- /c: the stamp lands once per session (the existing CSS path).
- Admin: number-ticker on KPIs only.

### 5.3 Where motion is not used

- Page loads, route changes, section entrances, scroll reveals, list staggers.
- Hover lifts, hover scales, parallax, cursor effects.
- The home page while idle: the balance at rest is still.
- Shimmer, border-beam, blur-fade, skeleton pulse, spinners on pages, count-up numbers, confetti, theme-switch animation.

### 5.4 Rules

- Animate only transform, opacity and stroke or fill colour. There are two exceptions: the phone stage height at the handover (one element, once) and disclosure heights.
- Focus moves and announcements never wait for an animation. Correctness never depends on `animationend`.
- Any `pointerdown`, `keydown`, `wheel` or `touchstart` during the settle jumps to the final frame. `scroll` is not listened to: every scroll a person starts begins with one of those, and the flow
- `will-change` is set only while the scene runs.

### 5.5 Reduced motion

Wrap the app in `<MotionConfig reducedMotion="user">` (already done). Keep the global CSS kill-switch.

- Every animation has a static state: no sway, dip, drop, tilt, crossfades, set-in, stamp spring, impact or vibration.
- The scene draws the balance level and still. The screenshot, labels and dots appear in their final places at once. The read line appears whole with static underlines.
- The settle is instant: the verdict, the flat sheet and the final stamp render in one frame. `READ_HOLD` is skipped.
- The reading caption gains one sentence of text, "This takes about 5 to 20 seconds.", so the wait is explained in words.
- Focus moves and announcements are the same in both modes.
- Imperative motion (`useTime`, `animate()`, `useAnimate`) ignores `MotionConfig`. Check `useReducedMotionConfig()` and mount the still variant instead (section 7.8).

---

## 6. The flow: states, decisions, URLs, API calls

### 6.1 Overview

```
home ── add, drop or paste ──▶ SCENE ─────────────────────────────▶ RESULT
                               reading   POST /api/extract              │
                               (finding) GET /api/buildings/match       ├─ Edit ──▶ FORM ── Compare price ──▶ SCENE (weighing) ──▶ RESULT
                               asking    one question at a time         │
                               weighing  POST /api/checks               └─ Compare another listing ──▶ home
home ── Type the details ──▶ FORM ── Compare price ──▶ SCENE (weighing) ──▶ RESULT
```

Note: the match endpoint is `GET /api/buildings/match` (the brief said POST). The read's own match comes inside the `POST /api/extract` response (`ExtractResponse.match`). So "finding the building" has a visible caption only when a separate match request runs.

### 6.2 Reducer changes (`src/hooks/use-check-flow.ts`)

Keep `flowReducer` pure and keep its existing guards (stale `readId`, phase checks).

```ts
export type FlowPhase =
  | "idle"
  | "reading"        // POST /api/extract in flight (readStage preparing | reading)
  | "matching"       // GET /api/buildings/match in flight after a typed building name
  | "asking"         // one question on screen
  | "comparing"      // POST /api/checks in flight (from the scene or the form)
  | "result"
  | "readFailed"     // a read failure, or a partial read, shown in the scene
  | "compareFailed"  // a compare failure from the scene
  | "details";       // the form: Edit, Type the details, Claude off "Type the details", partial read

export type Question =
  | { kind: "outcome"; outcome: "rental" | "not_listing" | "not_apartment" }
  | { kind: "field"; field: "bedrooms" | "sizeSqft" | "priceAed" | "buildingText" }
  | { kind: "psf" }        // price / size outside 300-6000: ask both
  | { kind: "building" };  // choose among candidates, None of these, or search

// New FlowState fields
question: Question | null;
answers: Partial<DetailsValues>;     // what the person answered; merged over `extracted`
outcomeAccepted: boolean;            // "It's for sale, continue"
pickedBuildingId: number | null | undefined; // undefined = not decided; null = None of these
matchKey: string | null;             // matchQueryKey() of the values `match` belongs to
compareFrom: "scene" | "form" | null;
lastPayload: SubmitPayload | null;   // for "Try again" after compareFailed
readDoneAt: number | null;           // for READ_HOLD
results: Record<string, CheckView>;  // results shown in this tab (at most 5), for Back/Forward
partial: boolean;
```

Remove the `outcome` phase. It becomes `asking` with `{ kind: "outcome" }`. `failure` stays `ReadFailure`, extended with `title: CopyKey` and `detail: string | null` (section 7.6).

New actions: `question/answer` (values), `question/pick` (buildingId or null), `outcome/accept`, `match/start`, `match/done`, `compare/start` ({ from, payload }), `compare/fail` ({ failure }), `nav/edit`, `nav/result` ({ code }).

### 6.3 `decideNext()` (new pure module `src/lib/flow/decide-next.ts`)

It is called after `read/done`, after every answer, after `match/done`, after `outcome/accept`, and when a form submit enters the scene.

```ts
export type Next =
  | { kind: "ask"; question: Question }
  | { kind: "match"; q: string; area: string | null; beds: number | null; completion: Completion | null }
  | { kind: "compare"; payload: SubmitPayload }
  | { kind: "partial" };

export function decideNext(s: FlowState): Next {
  // 1. Not a sale listing, and not accepted yet
  if (s.outcome && s.outcome !== "ok" && !s.outcomeAccepted) return ask({ kind: "outcome", outcome: s.outcome });
  const v = merged(s.extracted, s.answers); // answers win
  // 2. Too little was read: the scene says so and offers the form (never opens it by itself)
  const missing = REQUIRED.filter((k) => v[k] == null || v[k] === "");
  if (missing.length >= 3) return { kind: "partial" };
  // 3. One field at a time. Bedrooms first, because the building options count sales by bedrooms.
  for (const f of ["bedrooms", "sizeSqft", "priceAed"] as const) if (v[f] == null) return ask({ kind: "field", field: f });
  // 4. Plausibility (the same ListingFieldsSchema the server uses)
  const parsed = ListingFieldsSchema.safeParse({ ...v, areaText: v.areaText ?? null });
  if (!parsed.success) return ask(isPsfIssue(parsed.error) ? { kind: "psf" } : { kind: "field", field: firstBadField(parsed.error) });
  if (!v.buildingText?.trim()) return ask({ kind: "field", field: "buildingText" });
  // 5. A match for these values (the read's match, or a fresh one after a typed name)
  const key = matchQueryKey({ ...v, completion: s.completion });
  if (!s.match || (s.matchKey !== key && needsFreshMatch(s))) return { kind: "match", q: v.buildingText, area: v.areaText ?? null, beds: v.bedrooms ?? null, completion: s.completion ?? null };
  // 6. The building
  const m = s.match;
  let buildingId: number | null | undefined = s.pickedBuildingId;
  if (buildingId === undefined) {
    if (m.preselectId !== null && !m.towerCheck && !m.areaCheck) buildingId = m.preselectId;
    else if (m.candidates.length === 0) buildingId = null;           // nothing similar: not covered
    else return ask({ kind: "building" });                           // tie, tower, area, or no strong match
  }
  return { kind: "compare", payload: { fields: parsed.data, buildingId, editedFields: editedFieldsOf(s.extracted, v), completion: s.completion } };
}
```

- `needsFreshMatch(s)` is true when the building name was answered (or changed), or when bedrooms were answered and a building question is about to be asked. Fresh counts make the options read correctly. When the read's preselect is strong, bedrooms do not affect it, so there is no fresh match.
- Auto-compare happens only on the strictest path: all four fields read (or answered), the schema passes (including AED per sq ft 300-6000), a preselect at 0.8 or above, and no `towerCheck`, `areaCheck` or tie.
- An empty candidate list goes straight to "Not covered yet". That result offers "Search covered buildings", which reruns the scene with the chosen building (no form).
- Claude off plus pasted text: `parseFields` gives bedrooms, size and price but never a building. `decideNext` then asks "Which building is it in?", runs a match and goes on. No form.

Hook side (`useCheckFlow`): `advance()` reads `stateRef.current`, calls `decideNext`, and acts:

- `ask`: dispatch the question and move focus to its heading.
- `match`: `api.match(...)`.
- `compare`: `api.createCheck(...)`. The request fires at once. The visual settle waits for `READ_HOLD`, not the request.
- `partial`: show the partial state in the scene.

### 6.4 `sceneStage()` (new pure selector `src/lib/flow/scene-stage.ts`)

```ts
export type SceneStage = "placing" | "reading" | "found" | "finding" | "asking" | "weighing" | "settling" | "failed" | "partial" | "rest";
```

It maps phase, timers and flags to the stage the balance and captions draw. It is unit-tested with a row per phase.

### 6.5 URLs and history

| Moment | History | URL |
|---|---|---|
| Scene starts (file, drop, paste, Read text) | `pushState` | `/?step=compare` |
| Form opens from home ("Type the details") | `pushState` | `/?step=details` |
| Edit from a result | `pushState` | `/?step=details` |
| Compare price from the form | `replaceState` | `/?step=compare` |
| Result arrives | `replaceState` | `/?step=result&code=XXXX` |
| Search covered buildings, pick (on not covered) | `pushState` then `replaceState` | `?step=compare`, then `?step=result&code=YYYY` |

- Back from a result goes to the entry before it: home, or the earlier result after an Edit. A code in `state.results` shows that result. An unknown code goes to `/c/<code>` (as today).
- Back during the scene works like Stop.
- Back from the form returns to the result when one exists, otherwise home.
- A reload of `?step=compare` or `?step=details` returns home (as today). A reload of `?step=result&code=` redirects to `/c/<code>` (as today, in `page.tsx`).
- `readUrlStep()` and `flowUrl()` learn `compare`. `FlowStep` becomes `"home" | "compare" | "details" | "result"`. `stepOf()` and the `mizanStep` marker change to match.

### 6.6 Compare from the scene

- `compare/start` sets `compareFrom: "scene"`. `createCheck` sends `{ fields, buildingId, source, editedFields, propertyType?, completion?, ref? }`, exactly as today.
- A `validation_failed` response with field errors opens the form (`phase: details`) with the errors. This is rare, because the client ran the same schema.
- `rate_limited`, `building_not_found` and other failures go to `compareFailed` with `lastPayload`. "Try again" re-posts it. "Edit the details" opens the form.

---

## 7. The processing scene

### 7.1 The stage slot

Every flow screen uses one layout, `FlowLayout`, with five slots: `notices`, `head`, `stage`, `below` and `rest`. It renders under one stable key for the scene, the questions and the result, so the stage cell and its sticky position never re-mount.

- **Phone:** notices, head, stage, below, rest, all stacked.
  - `head`: min-height 88px (two lines of `type-display-lg`).
  - `stage`: full content width in a 4:5 box (358x448 at 390), radius 4.
- **Desktop:**
  - head, below and rest take cols 1-6.
  - The stage takes cols 7-12, sticky at `top: header + 32px`, centred.
  - Stage width: `min(420px, (100dvh - 160px) * 0.8)` for the balance. The sheet keeps its existing caps.
- What the stage holds:
  - Home (desktop only): the balance at rest.
  - Scene: the balance, working.
  - A building question on desktop: your screenshot, unstamped.
  - Result: the stamped sheet.
  - Changes are crossfades within the same cell.

### 7.2 Geometry (`src/components/scene/balance-geometry.ts`)

viewBox `0 0 360 450` (4:5). Strokes use `vector-effect="non-scaling-stroke"` and `stroke="currentColor"` (ink).

| Part | Geometry |
|---|---|
| Pivot | (180, 132). A knob of r 4: `--background` fill, ink stroke 1.5. |
| Beam | From (60,132) to (300,132), 2 wide, round caps, end rings r 3. A needle from the pivot up to (180,108), 1.25. An invisible rect (60,108)-(300,156) makes the group's box centre the pivot, so `originX/originY: 0.5` rotates about it. |
| Post and base | The post runs x=180 from y=138 to 396 (1.5). The base is a line from (132,396) to (228,396), 2. |
| Pans (each) | Hang from a beam end E: a 1.25 rod from E to E+(0,18). Two strings from E+(0,18) to the tray rim at E+(-48,150) and E+(48,150). The tray is the quadratic arc from E+(-48,150) to E+(48,150), control point E+(0,166), stroke 1.5. Pans are translated, not rotated, so they hang plumb. |
| Left load | The screenshot: SVG `<image href={blobUrl}>`, 60 wide, height `min(60 * h/w, 110)`, `preserveAspectRatio="xMidYMin slice"`, a clipPath rect with rx 3, and a 1px `--border` frame (dark mode `rgb(255 255 255/.12)`). It stands on the tray, bottom at E.y+146. Strings draw behind it. Pasted text and typed details draw a paper slip instead: a 52x68 `#F6F7F4` rect, 1px `--input` stroke, four 1px pencil lines. |
| Right load | Sales dots, r 3.6, ink fill. A pyramid on the tray with rows of 9, 8 and 7 (at most 24), spacing 9.5, bottom row centred at E.y+144. Hollow dots: no fill, 1.25 stroke in `--input`. |
| Labels | HTML, not SVG text, so they stay 14px or more. They are `aria-hidden` (the caption, the read line and the result carry the meaning). There are two blocks, centred under the pans' rest x (16.7% and 83.3% of the box width), at 82% of the box height. Line 1: Archivo 17/500 tabular, ink. Line 2: Archivo 14 muted. |

```ts
export const VIEW = { w: 360, h: 450 } as const;
export const PIVOT = { x: 180, y: 132 } as const;
export const ARM = 120;
export const MAX_TILT = 9;   // degrees
export const FULL_AT = 0.3;  // |diff| at which the tilt is full

/** Degrees for a comparison. SVG rotation is clockwise-positive, so the listing (left) pan goes down for diff > 0. */
export function angleFor(diff: number | null): number {
  if (diff === null) return 0;
  return -Math.max(-1, Math.min(1, diff / FULL_AT)) * MAX_TILT;
}

/** Beam end offsets from their rest positions for a beam angle in degrees. */
export function panOffsets(deg: number) {
  const a = (deg * Math.PI) / 180;
  const dx = ARM * (1 - Math.cos(a));
  const dy = ARM * Math.sin(a);
  return { left: { x: dx, y: -dy }, right: { x: -dx, y: dy } };
}
```

In-line results (|diff| up to 5%) tilt by 1.5° or less, so they read as level. That is the meaning.

### 7.3 Stage-by-stage storyboard

Captions sit in the head slot in `type-display-md`, as an `h2` with `tabIndex={-1}`. The scene container has `aria-busy="true"` while working. The live region is the existing polite one in the layout.

| # | Flow state and API | Caption (head) | Balance (stage) | Below slot | Announce |
|---|---|---|---|---|---|
| 0 | `read/start`: `pushState ?step=compare`, downscale, then `POST /api/extract` | "Reading the listing" (pasted text: "Reading the listing text"). It is set at once, because it answers the tap. Stop sits on the right of the caption row, a 44px text button. | The home content fades out (140ms ease-in). The balance fades in (160ms) if it was not on screen (phone). After `img.decode()`, the screenshot drops onto the left pan (y -24 to 0, opacity 0 to 1, 280ms ease-out). The beam dips to -3° on `BEAM_DIP`, then rests at -0.6°. | Empty, with a reserved min-height on desktop (3 lines). | `read.announce` |
| 1 | `reading`: extract in flight, typically 3-12s | Unchanged. The "preparing" downscale shares this caption (one visual stage, one announcement). | Sway ±1.6° about -0.6°, period 2.4s. Pans hang plumb. Nothing else moves. No scan line, beam or shimmer. | At 8s (`SLOW_AFTER_MS`) "Still reading. This can take up to 20 seconds." fades in (200ms), with the text button "Type the details instead". | `read.slow` once |
| 2 | `read/done`, outcome ok: found | The caption stays. | The amplitude falls to 1.0°. The left label fades in (180ms): an indigo 8px diamond plus "AED 1,908" over "this listing, per sq ft". The value is `priceAed / sizeSqft` through `formatInt`, as on the server. | The read line sets in (7.4). | `scene.read` ("Read: 2-bed, 1,284 sq ft, AED 2,450,000.") unless a question follows (its focus speaks) |
| 2a | `decideNext` gives `compare` | No change yet. | No change yet. | | |
| 2b | `decideNext` gives `ask` | The question (7.5). | The beam eases level (240ms), the sway stops, and the right tray rim turns dashed (`stroke-dasharray: 3 3`). | | Focus on the question heading |
| 2c | `decideNext` gives `partial` | "Fairsquare could only read part of this listing." | The beam eases level, and the strokes turn pencil (200ms colour). | "Type the details to finish, or try another screenshot." [Type the details] (the form, filled with what was read) and [Try another screenshot] | The caption text |
| 3 | `matching`: `GET /api/buildings/match` pending for more than 300ms | "Finding the building" | The amplitude falls to 0.8°. | | The caption, once |
| 4 | `comparing`: `POST /api/checks` pending for more than 300ms | "Weighing it against registered sales in {building}" (the chosen candidate's name; the final count is not known yet) | The amplitude falls to 0.6°. `min(salesForBedrooms, 24)` dots drop onto the right pan: from y -16, opacity 0 to 1, 200ms ease-out, stagger `min(30ms, 240ms / n)`. The right label: "11" over "registered sales". | After 4s: "Still comparing." | The caption, once |
| 5 | `compare/done`: the settle (7.7) | Becomes the verdict | Settles and tilts, then hands over to the stamped sheet | The read line "dries" and Edit appears | `resultAnnouncement()` (verdict sentence plus stale note) |

Rules:

- A middle caption (stages 3 and 4) appears only after `SHOW_AFTER` (300ms). If the response comes first, the stage passes without a caption. There is no minimum dwell. Every swap is a 200ms crossfade, so a late caption fades and never flashes.
- When a stage ends, all its timers are cleared (one `useEffect` cleanup per stage).
- Esc stops reading while focus is inside the scene.
- The 28s backstop (`READ_BACKSTOP_MS`) leads to the timeout failure.
- Input variants:
  - Pasted text: the left pan carries the paper slip. The result sheet is the listing plate.
  - Typed details or the form's Compare price: the scene starts at stage 4. The slip is already on the pan and the left label is set. The settle starts at `max(check arrives, 160ms)` so the balance has faded in.
  - Claude off: there is no read. Home's primary is "Type the details". Paste uses the local parser and enters the scene at the building-name question.

### 7.4 The read line (`src/components/scene/read-line.tsx`)

`type-lead` in Newsreader. The label is in `--muted-foreground`; the figures and building are in ink with `lining-nums`.

```
Read from your screenshot: a 2-bed of 1,284 sq ft in Test Tower D, Dubai Marina, asking AED 2,450,000.  Edit details
```

- Label by source: `result.readImage` (Claude read an image), `result.readText` (pasted text), `result.readTyped` (typed details).
- The building is the compared building (`buildingLabel(check)` plus its area) once known. Before that it is the read `buildingText`.
- No middle dots. The copy test bans `·`.
- **Set-in** (stage 2):
  - Each figure reveals bottom-up (`clip-path: inset(100% 0 0 0)` to `inset(0)`, 220ms ease-out, 60ms stagger, at most 400ms in all).
  - Then a 1px ink underline draws under it: a `::after` span with `transform: scaleX(0)` to `1`, origin left, 160ms.
- A field not read yet shows a 40px blank ink rule (1px, baseline). The answer sets into it.
- At the settle the underlines "dry" (opacity to 0, 280ms) and "Edit details" fades in. Edit is an underlined Archivo text button, 44px hit area.
- On the result it is a `<p>` with Edit as a `<button>` that opens the form (`nav/edit`).

### 7.5 The one-question interrupt (`src/components/scene/scene-question.tsx`)

Every question uses the head slot for its heading (`type-display-md`, `h2`, `tabIndex={-1}`, focus target). Answers sit right under it.

- **Phone:** the stage collapses (`hidden`, so the balance stays mounted and keeps its motion values). The question block takes its place in normal flow. A 56x96 thumbnail of the screenshot sits right of the heading. It is a button named `read.view` that opens `ScreenshotDialog`. The read line follows the controls.
- **Desktop:**
  - A building question swaps the stage (200ms crossfade) from the balance to your screenshot as an unstamped sheet, whole and sticky, so you can check the tower number by eye. Other questions keep the balance, still, with the dashed right tray.
  - Controls sit in cols 1-6 under the heading. The read line sits above the controls.
- After an answer: the value sets into the read line (220ms), the controls collapse (180ms ease-in), and `advance()` runs at once. "Type all the details instead" (`ask.typeAll`) is always the last control and opens the form with everything known.

| Question | Heading | Note (`type-lead`, muted) | Controls |
|---|---|---|---|
| Building | "Which building is this?" | `ask.buildingSays` ('The listing says "Test Tower D".'), then `pick.lookalike` or `pick.sameName` when flagged. | Up to 3 candidate rows, then "None of these" (`pick.none`, sub `pick.noneSub`), then "Search covered buildings" (`pick.search`, opens the existing `BuildingSearch`), then `ask.typeAll`. |
| Building name (not read) | "Which building is it in?" | `ask.notIn` | One 48px input labelled `field.building`, and [Continue]. Continue runs a match (stage 3). |
| Bedrooms | "How many bedrooms?" | `ask.notIn` | 8 buttons (Studio, 1, 2, 3, 4, 5, 6, 7+, from `field.bedroomsOptions`), 48px tall, 1px `--input` outline, radius 6. 4 per row on phones, one row on desktop. A tap continues. |
| Size | "What's the size?" | `ask.notIn` | One 56px input, Archivo 22 tabular, suffix `field.sqft`, `inputMode="numeric"`, [Continue]. Enter submits. Errors use `err.*`. |
| Price | "What's the asking price?" | `ask.notIn` | The same, with the prefix `field.aed`. |
| Price per sq ft | "Check the size and price." | `FIELD_ERRORS.psf(psf)` | Both inputs, filled with what was read, and [Continue]. |
| Outcome: rental | `ask.rentalH` "This looks like a rental listing." | `ask.rentalBody` | [It's for sale, continue] (`alert.rentalContinue`, primary), [Try another screenshot] (`alert.tryAnother`, outline), Type the details (text) |
| Outcome: not a listing | `ask.notListingH` | `ask.notListingBody` | [Try another screenshot] primary, Type the details (text) |
| Outcome: villa | `ask.villaH` | `ask.villaBody` | [Type the details anyway] (`alert.anyway`, primary: the form), [Try another screenshot] (outline) |

- `ask.notIn` reads "It isn't in the screenshot." For pasted text use `ask.notInText`, "It isn't in the listing text."
- **Candidate rows** are `<button type="button">`, full width, min-height 64px, hairline above and below, padding 12px 0, no box.
  - Line 1: the name in `type-title` (Newsreader 20/560).
  - Line 2: the area (`areaLabel`) and the `coverageLine()` text in Archivo 14 muted.
  - A ChevronRight sits on the right in muted colour.
  - Hover: `--accent` fill. Focus: a 2px inset ink ring.
  - The accessible name is the full text: "Test Tower D, Dubai Marina, 11 ready two-bed sales in 12 months".
  - The preselected candidate (if any) is listed first, with no tag. The person is being asked to look.
- **Activating a row is an explicit command.** It continues at once (WCAG 3.2.2 holds, because buttons are not form inputs). This reverses DESIGN.md decision 12 (select, then press Compare price) for the scene only. The form keeps radios and a Compare price button.

### 7.6 Slow, failed, rate-limited, Claude off (in the scene's language)

When a failure arrives:

- The beam eases level (240ms) and the sway stops.
- All strokes change from ink to `--muted-foreground` (200ms colour).
- The screenshot on the pan takes `opacity: .5; filter: grayscale(1)`. The filter is static, not animated.
- The caption becomes the cause, in serif (`fail.*`). An optional `detail` line follows in `type-lead` muted.
- The actions sit under it: primary ink, then outline, then a text button.
- The full existing sentence (`ReadFailure.message`) is announced.
- Focus moves to the cause heading.

| Code | Title | Detail | Actions |
|---|---|---|---|
| `timeout` (backstop), `extract_timeout` | `fail.timeout` "Reading took too long." | none | [Try again] [Type the details] |
| `extract_unreadable` | `fail.cutShort` "The reading was cut short." | none | [Try again] [Type the details] |
| other read errors | `fail.read` "Reading failed." | none | [Try again] [Type the details] |
| `extract_refused` | `fail.refused` "Claude couldn't read this one." | none | [Type the details] [Try another screenshot] |
| `unsupported_image`, `image_rejected` | `fail.image` "That image couldn't be read." | `fail.imageHint` "Try a JPEG or PNG screenshot." | [Try another screenshot] [Type the details] |
| `image_too_large`, `empty_input` | `fail.image` | `apiError.image_too_large` or `apiError.empty_input` | [Try another screenshot] [Type the details] |
| `extract_busy` | `fail.busy` "Claude is busy right now." | none | [Try again in 24 s] (`rate.retryIn`; `aria-disabled` until `retryAt`; a tabular countdown updates each second with no announcement; one announcement when it becomes active) [Type the details] |
| `extract_unavailable` | `fail.off` "Screenshot reading is off right now." | `fail.offHint` "Typing the 4 details takes about 20 seconds." | [Type the details] only. Home switches to its Claude-off layout. |
| `rate_limited` | `fail.limit` "That's the limit for now." | the server message (`rateLimitMessage`) | [Type the details] |
| `daily_cap_reached` | `fail.limit` | `rate.dailyCap` | [Type the details] |
| `offline` | `fail.offline` "You're offline." | none | [Try again] [Type the details] |
| compare failure | `fail.compare` "Couldn't compare just now." | the server message for `rate_limited` or `building_not_found`, else none | [Try again] (re-posts `lastPayload`) [Edit details] |

- **Stop** aborts and returns home with the screenshot kept (`read.stopped` is announced).
  - Phone home shows a row: a 64x112 thumbnail and `read.stopped` (14 muted), then [Try again] (primary), Replace (text), Remove screenshot (text).
  - Desktop home shows the screenshot standing on the balance's left pan at rest, with the same three actions under the home actions.
  - Focus goes to [Try again].

### 7.7 The settle (at most 900ms from t = 0, the moment the check is in hand and `READ_HOLD` has passed)

At t = 0:

- The result tree mounts inside `FlowLayout`: the verdict heading (opacity 0), the stamped sheet (opacity 0, stamp not started), the sentence, and the rest (opacity 0).
- Focus moves to the verdict heading (`preventScroll`). `scrollIntoViewSafe(top)` brings the top of the flow into view.
- The live region announces `resultAnnouncement(check, data)`.
- `history.replaceState(... ?step=result&code=)`.
- `aria-busy` is removed.

| Time (ms) | What happens |
|---|---|
| 0-200 | Dots are reconciled: the right pan shows `count + outliersDropped` dots (cap 24). Missing ones drop in (as in stage 4) and extra ones fade out. From 120ms, `outliersDropped` of them turn hollow (fill to none, 160ms). The right label crossfades (160ms) to "AED 1,669" over "median of 11 registered sales". Thin: tally dots, `minSales` slots with `count` filled, and the label `thin.progress`. Not covered: no dots, label `band.none`. |
| 60-380 | Sway amplitude goes to 0 (`SWAY_AMP`). The base springs to `angleFor(diff)` on `BEAM_SETTLE`. Thin and not covered stay level. |
| 340-500 | Handover. The caption fades out (120ms ease-in) and the verdict heading fades in (160ms ease-out, y 6 to 0) in the same reserved head slot. The balance fades out (140ms ease-in) and the sheet fades in (140ms ease-out) in the same stage cell. On phones, if the sheet's crop height differs from the 4:5 box (plate, wide screenshot, not covered), the stage height animates over 200ms. |
| 480-820 | The stamp lands on the sheet. This is the existing `Stamp` spring (opacity 0, scale 1.14, rotate -4° relative to the final -9°), with the new prop `delay = 0.48`. |
| about 600 | Impact: the sheet moves 1.5px down and back (120ms). One `navigator.vibrate(12)` on Android coarse pointers, never on iOS. |
| 640-880 | The read-line underlines dry (280ms) and "Edit details" fades in. The phone action bar slides up (translateY 100% to 0, 240ms ease-out). Desktop inline actions fade in. |
| 700-900 | The sentence, notices, disclosures, cost row and provenance fade in (200ms, opacity only; their space is laid out from t = 0). |

- Not covered: there is no stamp. The handover only crossfades to the unstamped sheet on desktop. On phones the stage collapses to 0 (section 8.5).
- Interrupt: any tap, key, wheel or scroll calls `controls.complete()` on the sequence, sets the stamp to its final state, and sets the beam springs with `.jump()`. Nothing waits for `animationend`.
- A result reached by Back or Forward (`nav/result`) renders final, with no settle (the existing `useFirstLanding`).

### 7.8 Implementation sketch

New folder `src/components/scene/`:

```
balance-geometry.ts   constants, angleFor(), panOffsets(), dotLayout(n), loadBox(imageSize)
balance.tsx           pure SVG, aria-hidden; props: angle (MotionValue<number>), load, dots, dimmed, dashedRight, dragOver
use-balance.ts        motion values for the beam (sway, base, amplitude) by SceneStage; still variant under reduced motion
balance-labels.tsx    the two HTML label blocks under the pans
flow-layout.tsx       slots: notices, head, stage, below, rest, actionBar; one stable key
compare-scene.tsx     captions, Stop, slow note, failure view, partial view; reads FlowState via sceneStage()
scene-question.tsx    the questions of section 7.5
read-line.tsx         the read line and its set-in
screenshot-dialog.tsx ScreenshotDialog and ScreenshotThumb, moved from check/reading-status.tsx
use-settle.ts         the useAnimate sequence of section 7.7, with interrupt
```

```tsx
// use-balance.ts (sketch)
import { useMotionValue, useReducedMotionConfig, useSpring, useTime, useTransform, type MotionValue } from "motion/react";
import { useEffect } from "react";

const AMP: Partial<Record<SceneStage, number>> = { reading: 1.6, found: 1.0, finding: 0.8, weighing: 0.6 };
const BASE: Partial<Record<SceneStage, number>> = { reading: -0.6, found: -0.6, finding: -0.6, weighing: -0.6 };

export function useSwayingBeam(stage: SceneStage, target: number | null): MotionValue<number> {
  const time = useTime();
  const amp = useSpring(0, SWAY_AMP);
  const base = useSpring(0, BEAM_SETTLE);
  useEffect(() => {
    amp.set(AMP[stage] ?? 0);
    base.set(stage === "settling" && target !== null ? target : (BASE[stage] ?? 0));
  }, [stage, target, amp, base]);
  return useTransform(() => base.get() + amp.get() * Math.sin((time.get() / SWAY_PERIOD) * 2 * Math.PI));
}

/** Reduced motion: no time source, no springs; the beam is drawn at rest. */
export function useStillBeam(): MotionValue<number> {
  return useMotionValue(0);
}

// The caller picks the variant once (hooks cannot be conditional), as two components:
export function BalanceStage(props: StageProps) {
  const reduce = useReducedMotionConfig() === true;
  return reduce ? <StillBalance {...props} /> : <SwayingBalance {...props} />;
}
```

```tsx
// balance.tsx (sketch)
export function Balance({ angle, load, dots, dimmed, dashedRight }: BalanceProps) {
  const left = useTransform(angle, (d) => panOffsets(d).left);
  const right = useTransform(angle, (d) => panOffsets(d).right);
  const lx = useTransform(left, (p) => p.x), ly = useTransform(left, (p) => p.y);
  const rx = useTransform(right, (p) => p.x), ry = useTransform(right, (p) => p.y);
  return (
    <svg viewBox="0 0 360 450" aria-hidden="true" focusable="false" data-balance="" data-dimmed={dimmed || undefined}
         className="block h-auto w-full text-foreground transition-colors duration-(--dur-base) data-dimmed:text-muted-foreground">
      {/* vector-effect is not inherited: the CSS rule `[data-balance] :is(line,path,circle) { vector-effect: non-scaling-stroke }` sets it on every stroke */}
      <g fill="none" stroke="currentColor" strokeLinecap="round">
        <line x1={180} y1={138} x2={180} y2={396} strokeWidth={1.5} />
        <line x1={132} y1={396} x2={228} y2={396} strokeWidth={2} />
        <motion.g style={{ rotate: angle, originX: 0.5, originY: 0.5 }}>
          <rect x={60} y={108} width={240} height={48} fill="none" stroke="none" />  {/* centres the box on the pivot */}
          <line x1={60} y1={132} x2={300} y2={132} strokeWidth={2} />
          <line x1={180} y1={132} x2={180} y2={108} strokeWidth={1.25} />
          <circle cx={60} cy={132} r={3} /><circle cx={300} cy={132} r={3} />
        </motion.g>
        <circle cx={180} cy={132} r={4} className="fill-background" strokeWidth={1.5} />
        <motion.g style={{ x: lx, y: ly }}><Pan cx={60} /><PanLoad load={load} cx={60} /></motion.g>
        <motion.g style={{ x: rx, y: ry }}><Pan cx={300} dashed={dashedRight} /><SaleDots dots={dots} cx={300} /></motion.g>
      </g>
    </svg>
  );
}
```

```tsx
// use-settle.ts (sketch)
export function useSettle(active: boolean, onDone: () => void) {
  const [scope, animate] = useAnimate();
  const reduce = useReducedMotionConfig() === true;
  useEffect(() => {
    if (!active) return;
    if (reduce) { onDone(); return; }
    const controls = animate([
      ["[data-scene-caption]", { opacity: 0 }, { duration: 0.12, ease: EASE_IN, at: 0.34 }],
      ["[data-verdict]", { opacity: [0, 1], y: [6, 0] }, { duration: 0.16, ease: EASE_OUT, at: 0.36 }],
      ["[data-stage-balance]", { opacity: 0 }, { duration: 0.14, ease: EASE_IN, at: 0.34 }],
      ["[data-stage-sheet]", { opacity: [0, 1] }, { duration: 0.14, ease: EASE_OUT, at: 0.36 }],
      ["[data-read-ink]", { opacity: 0 }, { duration: 0.28, at: 0.64 }],
      ["[data-after-settle]", { opacity: [0, 1] }, { duration: 0.2, at: 0.7 }],
    ]);
    void controls.then(onDone);
    const skip = () => controls.complete();
    // listenOnce (src/lib/use-interrupt.ts): adds capture+passive+once listeners, returns a cleanup that removes them and runs the last callback
    return listenOnce(["pointerdown", "keydown", "wheel", "touchstart", "scroll"], skip, () => controls.stop());
  }, [active]);
  return scope;
}
```

- Every element the sequence names is in the DOM at t = 0 (opacity 0 by style), so the selectors resolve.
- `StampedSheet` gains `landingDelay` and passes it to the new `Stamp` prop `delay` (today it is hard-coded to 0.12s). Its `BlurFade` wrapper is removed.
- The scene's screenshot uses the same blob URL as the sheet (`state.image.url`). It is decoded once with `img.decode()` before it is placed. `img-src blob:` is already in the CSP.

---

## 8. Screens

The wireframes are CSS px. `[Label]` is a button, `Label_` an underlined text button, `----` a hairline.

### 8.1 Header

```
390, 56px, sticky, paper fill, hairline appears after 8px of scroll (IntersectionObserver sentinel)
| [mark 28] Fairsquare (Newsreader 22/600)            Saved 2   [Menu 44] |

1280, 64px
| [mark 28] Fairsquare   Compare   Saved 2   Coverage            How Fairsquare compares   [theme 44] |
```

- The desktop header has no Arabic name next to the wordmark: it was retired with the rename on 18 Nov 2026.
- Links: Archivo 15/500, muted. The current page is ink, with a 1.5px ink underline 6px below the baseline and `aria-current="page"`.
- The Saved count is plain tabular text in ink 500 next to "Saved". No Bookmark icon and no badge. The accessible name stays `nav.savedSr`.
- Menu opens the existing Sheet: Compare a listing, Saved, Coverage, How Fairsquare compares, Privacy, Theme. Rows have hairlines.

### 8.2 Footer (Archivo 14, muted, hairline top, 48px top and 64px bottom padding)

```
390
Fairsquare (Newsreader 22)
How Fairsquare compares    Coverage    Privacy          (44px targets, wrap, no separators)
Source: Dubai Land Department sales transactions, published as open data on Data.Dubai and used under the Dubai Open Data Licence.   (dataset and licence linked)
Fairsquare is independent. It is not affiliated with or endorsed by the Dubai Land Department or the Government of Dubai.
Fairsquare compares asking prices with registered sales. It is not a valuation and not financial advice.
Fairsquare uses Claude, Anthropic's AI, to read screenshots.

1280: cols 1-4 hold the wordmark and the links. Cols 7-12 hold the four statements, max 60ch.
```

The footer shows the English wordmark only. The Arabic name and its gloss were retired with the rename on 18 Nov 2026.

No logos of the DLD or the Government of Dubai, anywhere.

### 8.3 Home

```
390
| header 56                                          |
| 40                                                 |
| Weigh the                  type-display-xl 44/1.0  |
| asking price.                                      |
| 16                                                 |
| Add a screenshot of a Dubai apartment listing.     |  type-lead 18, 34ch
| Fairsquare compares its price per sq ft with       |
| registered sales in the same building.             |
| 24                                                 |
| [notice: stale data / reading off, when present]   |  left-ruled line
| [########## Add a screenshot ##########]   52 ink  |
| 8                                                  |
| Paste listing text_      Type the details_         |  text buttons, 44px, 24px apart
| 8                                                  |
| Fairsquare uses Claude, Anthropic's AI, to read    |  caption 14 muted
| your screenshot. It isn't stored. Privacy_         |
| 56                                                 |
| ------------------------------------------------   |
| From the data                  label 14/500 muted  |
| Test Tower D had the most registered sales of      |  type-statement 21/1.4
| ready 2-bed apartments in the 12 months to         |
| 10 Nov 2026: 11, at a median of AED 1,669 per      |
| sq ft.                                             |
| Dubai Marina (DLD area: Marsa Dubai). Registered   |  caption
| sales from 5 Jan 2026 to 10 Nov 2026.              |
| See all buildings Fairsquare covers_               |
| Sales data runs to 10 Nov 2026.                    |  caption
| footer                                             |

1280
| cols 1-6 (pt 96)                              | cols 7-12                                   |
| Weigh the                type-display-xl 88   |        [ balance at rest, 420x525 ]         |
| asking price.                                 |                                             |
| lead 20 (30ch)                                |   Drop a screenshot on the scale            |  Archivo 15 ink, centred
| [Add a screenshot]   Paste listing text_      |   or paste it with Ctrl V                   |  caption muted, plain text
|                      Type the details_        |                                             |
| privacy caption                               |                                             |
| 72                                            |                                             |
| ---- From the data (statement 24, 52ch) ...   |                                             |
```

- No illustration on the phone home. The balance is the reveal when work starts. On desktop it is the drop target.
- Drop:
  - Dragging an image anywhere over the window sets `dragOver`. The beam tips -2.5° (`BEAM_TIP`), the left tray rim turns dashed, and the hint reads `home.dropActive`. Leaving reverses it. Enter and leave are counted, as today.
  - Dropping anywhere reads the file.
  - Pasting an image anywhere outside a field starts the scene (as today).
- "Paste listing text" expands a labelled textarea in place (200ms height): `--card` fill, 1px `--input`, 4 rows, then [Read text] (primary). Read text starts the scene with the paper slip.
- Claude off:
  - The notice `claudeOff.notice` sits above the actions.
  - The primary becomes "Type the details", and "Paste listing text" stays (local parser, then the scene).
  - The privacy line hides.
  - The desktop balance stays, with no drop hint.
- After Stop: section 7.6.
- Removed: How it works 1-2-3, `home.scope` (folded into the lead), the boxed Alert, Kbd chips, the button icons, the label-value `dl` in From the data.
- The From the data skeleton is three static muted lines with no pulse.

### 8.4 Processing scene (`/?step=compare`)

```
390 (reading, 8s in)
| header 56                                          |
| 24                                                 |
| Reading the listing                     Stop_      |  head, min-h 88; type-display-md 30
| Still reading. This can take up to 20 seconds.     |  type-lead muted (from 8s)
| Type the details instead_                          |
| 16                                                 |
| +----------------- 358 x 448 -----------------+    |
| |                    |                         |   |
| |      ------------- o -------------           |   |  beam swaying
| |      /\            |            /\           |   |
| |     /[ ]\          |           /  \          |   |  your screenshot on the left pan
| |    \_____/         |          \____/         |   |
| |                  __|__                       |   |
| |  <> AED 1,908              11                |   |  labels (after read / while weighing)
| |  this listing,             registered sales  |   |
| |  per sq ft                                   |   |
| +----------------------------------------------+   |
| 16                                                 |
| Read from your screenshot: a 2-bed of 1,284 sq ft  |  read line (after read)
| in Test Tower D, Dubai Marina, asking              |
| AED 2,450,000.                                     |

1280
| cols 1-6                                      | cols 7-12 sticky                           |
| Reading the listing      type-display-md 44   |      [ balance 420x525, swaying ]           |
| Stop_                                         |                                            |
| (slow note and Type the details instead_)     |                                            |
| read line (min-h 3 lines)                     |                                            |
```

- The page keeps an `sr-only` h1 with `home.h1`. The caption is the h2.
- The stage is not a card: no border, no fill, just the drawing on paper.

### 8.5 Result

**Verdict (above, below, in line), 390:**

```
| header 56                                          |
| [stale note] [off-plan note]                       |  left-ruled lines
| 24                                                 |
| 14.3% above               type-display-lg 40/1.05  |  "14.3% above" in --verdict-above
| recent sales                                       |  head, min-h 88
| 20                                                 |
| [ stamped sheet 358 wide, 4:5 crop from top, r4,   |
|   elev-sheet; the stamp lands ]                    |
| See the whole card_     Hide contact details_      |  text buttons; the second only when detected
| (contact tip line, caption, only when detected)    |
| 20                                                 |
| This listing asks AED 1,908 per sq ft. The median  |  type-lead ink (result.sub)
| of 11 registered sales of ready 2-bed apartments   |
| in Test Tower D is AED 1,669 per sq ft.            |
| (size note, left-ruled, when off by more than 20%) |
| 12                                                 |
| Read from your screenshot: a 2-bed of 1,284 sq ft  |  read line + Edit details_
| in Test Tower D, Dubai Marina, asking AED          |
| 2,450,000. Edit details_                           |
| 32                                                 |
| ------------------------------------------------   |
| The 11 sales behind this                        v  |  type-title; closed on phones
| AED 1,593 to 1,763 per sq ft, Nov 2025 to Nov 2026 |  caption; shown when closed (result.salesRange)
| ------------------------------------------------   |
| About AED 10,618 a month with 20% down   Adjust_   |  Archivo 16; opens the existing Drawer
| ------------------------------------------------   |
| Building: Test Tower D, Dubai Marina (DLD area:    |  Provenance, caption 14 muted:
| Marsa Dubai). Source: Dubai Land Department sales  |  building, attribution (linked),
| transactions, published as open data on           |  window and basis, outliers,
| Data.Dubai and used under the Dubai Open Data      |  caveat, How Fairsquare compares_
| Licence. Sales from 10 Nov 2025 to 10 Nov 2026,    |
| same building, ready 2-bed apartments, per sq ft.  |
| Floor, view, condition and payment plans aren't    |
| included. This is not a valuation.                 |
| How Fairsquare compares_                           |
| Compare another listing_                           |
| [ Share card (ink, flex-1) | Save and track ]      |  sticky bar 72 + safe area, paper, top hairline
```

**Verdict, 1280:**

```
| cols 1-6                                       | cols 7-12, sticky at header + 32      |
| [notices]                                      |  [ stamped sheet, whole base,        |
| 14.3% above recent       type-display-lg 64    |    max-h 100dvh - 160 ]              |
| sales                                          |  See the whole card_                 |
| result.sub, type-lead 20, 52ch                 |  Hide contact details_               |
| read line + Edit details_                      |                                      |
| [Share card]  [Save and track]   48px inline   |                                      |
| 48                                             |                                      |
| ---- The 11 sales behind this (open): strip + table                                  |
| ---- About AED 10,618 a month with 20% down   Adjust_                                |
| ---- provenance caption; How Fairsquare compares_; Compare another listing_          |
```

- In line: "**In line** with recent sales" (graphite). The sentence is the existing `verdictSentence` (it says "within 5% of the median ...", so nothing repeats).
- Below: "**6.2% below** recent sales" (prussian blue). The sentence is `result.sub`.
- The sales strip: sale dots in ink, the band in `--chart-4`, the median as a 1.5px dashed ink line, and the listing diamond in `--stamp`. The table keeps the 2px indigo "This listing" bar. Its visible summary (`chartSummary`) names the chart, as today.
- **The sales list is never gated.** It is open by default from 1024px. On phones it is one tap, and the range shows on the closed trigger.
- Cost row: no Calculator icon. The Drawer, the estimator and the adviser opt-in (only when a partner is configured) are unchanged.
- **Thin** ("Too few sales to compare yet", ink):
  - The sheet carries the stamp "2 OF 5".
  - The sentence is `thin.body` (or `thin.bodyZero`).
  - Tally: `minSales` dots, 10px. `count` are filled ink and the rest are hollow, 1.5px `--input`. With `role="progressbar"` and the visible text `thin.progress`, as `ThinProgress` does today. This replaces the segment bar.
  - Read line.
  - [Save and track] is the primary and [Share card] the outline, with `save.helper` under them.
  - Then the sales list (if any), the cost row and provenance.
- **Not covered** ("Not covered yet", ink, `band.none`):
  - No stamp.
  - Phone: the stage collapses (no sheet).
  - Desktop: your screenshot or the plate, unstamped, in the stage.
  - The sentence is `verdictSentence(check)` ("We don't cover X yet.") followed by `none.body` with the covered count. While data is not loaded, it is `data.loading`.
  - Read line. Search covered buildings_ opens `BuildingSearch`. Picking a building reruns the scene from weighing with that building and the same values.
  - Cost row.
  - [Request it and track] is the primary in the bar (unchanged behaviour). After a request it shows the inert "Requested", and the confirmation shows as a plain `role="status"` line, not an Alert box.
- **Off-plan:** the `offplan.notice` line sits above the headline. The stamp's last line reads OFF-PLAN (unchanged).
- **Stale data:** the `data.stale` line is on top of every result and is announced with the verdict (unchanged).
- The verdict headline is an `h2` with `tabIndex={-1}`. It is the focus target. The phone head reserves 88px, and a headline never holds a building name, so caption and verdict swap without moving the stage.

### 8.6 Edit or type the details (`/?step=details`, the only form)

```
390
| < Back to the result_           (only when a result exists; ChevronLeft + text, 44px)  |
| Check the details               type-display-md 30 ("Type the details" on the typed path) |
| [thumb 48x84] Your screenshot   View screenshot larger_      (only with an image)        |
| Building            [48px input]                                                         |
|   candidate radio rows under it, hairlines, no boxes; chosen = 2px ink left bar + accent |
|   "Best match" as caption text (no pill) when strong and untied                          |
|   None of these / Search covered buildings_                                              |
| Area (optional)     [48px input]                                                         |
| Bedrooms            [Studio][1][2][3] / [4][5][6][7+]   toggle group, 48px              |
| Size                [_______ sq ft]     Asking price  [AED | ________]                    |
| [ ] Off-plan (not finished yet)  + helper                                                |
| (error summary when 2 or more errors)                                                    |
| [ Compare price ]   sticky bar on phones, inline from 1024                               |

1280: the form in cols 1-5 (max 480). Your screenshot as an unstamped sheet, sticky in cols 7-12.
```

- `DetailsForm` keeps its logic: draft, match debounce, editedFields and schema. It drops the boxes, pills and icons.
- Field source hints ("From your screenshot", "Changed by you") are caption text.
- Errors are 14px destructive text with TriangleAlert 16, and the field border turns `--destructive`.
- The sticky bar never covers content: `main` keeps its padding of `--action-bar-h` plus the safe area (today's bug in `02a-details-390-light.png`).
- Compare price enters the scene at stage 4 (`replaceState ?step=compare`), then the result.
- Partial read: the form opens filled with what was read, and the line `scene.partialBody` shows under the heading.

### 8.7 Share page `/c/[code]`

```
390
| [stale note]                                                         |
| Test Tower D, 2-bed. Compared on 18 Nov 2026.        caption, ink    |  } one h1: the caption span plus the
| 14.3% above               type-display-lg 40                         |  } verdict span (sr-only ": " between)
| recent sales                                                         |
| [ listing plate 358 wide + stamp; lands once per session (CSS) ]     |
| This listing asked AED 1,908 per sq ft ... (c.sentence, past tense)  |  type-lead
| Today: +12.1% vs 12 sales.     (Archivo 16/600, only when changed)  |
| ---- See the 11 sales behind this (open, never gated)                |
| provenance caption                                                   |
| [Save and track] outline                                             |
| [ Compare a listing you're looking at ]  sticky ink bar              |

1280: the result layout. Text in cols 1-6, the plate sticky in cols 7-12, the disclosure open, the CTA inline.
Not covered: h1 caption + "Not covered yet", the plate unstamped, c.cta.
```

**Plate text-safe zone** (fixes `04b-stale-result-1280-light.png`):

- `ListingPlate` sets text in container query units (`container-type: inline-size` on the sheet).
- Sizes:
  - Price: `clamp(20px, 7.4cqw, 44px)`, Archivo 700 wdth 100.
  - Detail lines: `clamp(14px, 3.4cqw, 20px)`.
  - Padding: `5.5cqw`.
- The text block stays inside the top-left 58% x 46% of the plate. The stamp keeps its bottom-right placement. Text and stamp never overlap at any width.
- The plate stays a fixed-colour document: paper `#F6F7F4` and ink `#13272C`, the same as the canvas card, so the screen and the shared PNG match.

The OG image and the card canvas do not change.

### 8.8 Coverage

```
390
| Buildings Fairsquare covers       type-display-md                                  |
| lead (Archivo 16, 60ch) + coverage.window caption                                    |
| Search buildings   [ Search icon  48px input ]   helper caption                      |
| ----------------------------------------------------------------------------------- |
| Test Tower D                       type-title 20                                      |
| Dubai Marina (DLD area: Marsa Dubai)                       caption                    |
| 11 ready, 3 off-plan. Latest sale 10 Nov 2026.             Archivo 14 tabular         |
| 2-bed: 11 sales, enough to compare                         Archivo 14 ink 500         |
| Studio: 1 sale, too few    1-bed: 3 sales, too few         Archivo 14 muted           |
| ----------------------------------------------------------------------------------- |
| Showing 1 to 50 of 1,240     Previous_  Next_                                         |
| Don't see your building?           type-heading                                       |
| Building name and area [input]  [Request this building]                               |

1280: the h1 and lead in cols 1-7, the request form in cols 9-12.
Table: Building | Area | Ready | Off-plan | Latest sale | Apartment types. Hairline rows,
Archivo 15 tabular, right-aligned numbers. Types as plain text lines: "enough to compare" in ink 500,
"too few" in muted. No pills, no icons.
```

### 8.9 How Fairsquare compares (`/how-it-works`)

- One column, max 640. Flush left on phones, starting at col 3 on desktop.
- h1 in `type-display-md` (desktop 44). The intro in `type-lead`.
- h2 sections in `type-heading`. The body in `type-prose`.
- "The rules" is a `<dl>` with hairlines between rows: terms in Newsreader 18/560, descriptions in `type-prose`.
- One static figure, "How the balance reads a listing": the scene's `Balance` at rest (no screenshot, a slip on the left pan, 7 dots on the right), `aria-hidden`, followed by an HTML `<figcaption>` with three labelled lines (`how.figListing`, `how.figSales`, `how.figBand`). No numbers in the drawing.
- The attribution and the independence line stay in "Where the data comes from". The page ends with [Compare a listing] (ink).
- No numbered steps. The TOC stays as a plain list of links.

### 8.10 Saved

- h1 in `type-display-md`. Rows are separated by hairlines, with no cards. Each row has:
  - The building in `type-title`.
  - "2-bed, AED 2,450,000" in Archivo 15.
  - The stored verdict words in verdict colour ("14.3% above"; "In line"; thin and not covered in ink).
  - The compared date as caption.
  - "3 new sales" in ink 500 as plain text, not a pill.
- Requests and adviser requests use the same row style.

### 8.11 Privacy, not found, errors

- Privacy uses the How layout: prose in Newsreader 18/1.6 and tables in Archivo.
- Not found and error pages: an h1 in `type-display-md`, one `type-lead` sentence and one primary action. No icons.

### 8.12 Admin (inherit only)

- Redefine `@utility wdth-heading` as `font-family: var(--font-display); font-variation-settings: normal;`. Every existing heading that uses it, admin included, then turns Newsreader with no edits.
- Redefine `wdth-title` as Archivo `font-variation-settings: "wdth" 100`.
- Admin tables, forms and KPIs stay Archivo. The primary is ink, and the charts use `--chart-1` (steel) and `--chart-2` (indigo).
- No admin layout changes. Check the admin screenshots after the token swap.

---

## 9. Copy changes (`src/lib/copy.ts`, mirrored in DESIGN.md section 6)

Rules:

- Short, plain English. "Compare" stays the one action verb on buttons, nav and the stamp.
- "Weigh" appears only in the home headline and the weighing caption. This needs owner sign-off (section 13).
- No `·` and no `→` (copy.test.ts). "registered sales" is the sales noun.

**Changed values** (keys kept):

| Key | New value |
|---|---|
| `home.h1` | Weigh the asking price. |
| `home.lead` | Add a screenshot of a Dubai apartment listing. Fairsquare compares its price per sq ft with registered sales in the same building. |
| `home.choose` | Add a screenshot |
| `read.reading` | Reading the listing |
| `read.matching` | Finding the building |

**New keys** (add rows to DESIGN.md section 6, in a new subsection "6.14 Scene, questions and result headline"):

| Key | Value |
|---|---|
| `home.dropScale` | Drop a screenshot on the scale |
| `home.pasteKeys` | or paste it with {keys} |
| `home.dataSentence` | {building} had the most registered sales of ready {bedType} apartments in the {months} months to {to}: {count}, at a median of AED {median} per sq ft. |
| `home.dataRange` | Registered sales from {from} to {to}. |
| `scene.readingText` | Reading the listing text |
| `scene.weighing` | Weighing it against registered sales |
| `scene.slowCompare` | Still comparing. |
| `scene.reducedHint` | This takes about 5 to 20 seconds. |
| `scene.read` | Read: {bedType}, {size} sq ft, AED {price}. |
| `scene.labelListing` | this listing, per sq ft |
| `scene.labelSales` | registered sale / registered sales |
| `scene.labelMedian` | median of {count} registered sales |
| `scene.partialH` | Fairsquare could only read part of this listing. |
| `scene.partialBody` | Type the details to finish, or try another screenshot. |
| `ask.buildingH` | Which building is this? |
| `ask.buildingSays` | The listing says 
| `ask.buildingNameH` | Which building is it in? |
| `ask.bedsH` | How many bedrooms? |
| `ask.sizeH` | What's the size? |
| `ask.priceH` | What's the asking price? |
| `ask.psfH` | Check the size and price. |
| `ask.notIn` | It isn't in the screenshot. |
| `ask.notInText` | It isn't in the listing text. |
| `ask.continue` | Continue |
| `ask.typeAll` | Type all the details instead |
| `ask.rentalH` | This looks like a rental listing. |
| `ask.rentalBody` | Fairsquare compares sale prices only. |
| `ask.notListingH` | That doesn't look like a property listing. |
| `ask.notListingBody` | Try a screenshot that shows the price. |
| `ask.villaH` | This looks like a villa or townhouse. |
| `ask.villaBody` | Fairsquare compares apartments only for now. |
| `fail.timeout` | Reading took too long. |
| `fail.cutShort` | The reading was cut short. |
| `fail.read` | Reading failed. |
| `fail.refused` | Claude couldn't read this one. |
| `fail.image` | That image couldn't be read. |
| `fail.imageHint` | Try a JPEG or PNG screenshot. |
| `fail.busy` | Claude is busy right now. |
| `fail.off` | Screenshot reading is off right now. |
| `fail.offHint` | Typing the 4 details takes about 20 seconds. |
| `fail.limit` | That's the limit for now. |
| `fail.offline` | You're offline. |
| `fail.compare` | Couldn't compare just now. |
| `result.headAbove` | {pct}% above |
| `result.headBelow` | {pct}% below |
| `result.headInline` | In line |
| `result.headRest` | recent sales |
| `result.headInlineRest` | with recent sales |
| `result.sub` | This listing asks AED {asking} per sq ft. The median of {count} {salesAdj} sales of {basis} {bedType} apartments in {building} is AED {median} per sq ft. |
| `result.readImage` | Read from your screenshot: |
| `result.readText` | Read from your text: |
| `result.readTyped` | Your details: |
| `result.readBody` | a {bedType} of {size} sq ft in {building}, asking AED {price}. |
| `result.salesRange` | AED {min} to {max} per sq ft, {from} to {to} |
| `details.h2Typed` | Type the details |
| `details.back` | Back to the result |
| `how.figCaption` | How the balance reads a listing |
| `how.figListing` | Left: this listing, its asking price divided by its size. |
| `how.figSales` | Right: registered sales of the same apartment type in the same building, over {months} months. |
| `how.figBand` | Within {bandPct}% of their median either way counts as in line. |

**Retired keys** (remove from copy.ts and from DESIGN.md section 6, and update the lists in copy.test.ts):

`home.howH2`, `home.how1`, `home.how2`, `home.how3`, `home.scope`, `home.dropHint`, `home.dataLead`, `home.dataMedian`, `home.dataSales`, `home.dataSalesValue`, `step.progress`, `step.names`, `step.progressLabel`, `read.preparing`, `read.done`, `result.h2`, `footer.gloss`.

- `footer.gloss` was a new key in the first build. It was retired with the rename on 18 Nov 2026, together with the Arabic name it explained.
- `copy.test.ts` "fills placeholders" uses `result.h2`. Switch it to `result.headAbove`.
- `outcome.*` and `OUTCOME_COPY` stay, for the announcements and the existing test.
- `error.*` and `rate.*` stay. They are the announced sentences and the `ReadFailure.message`.

---

## 10. What to delete, add and edit

**Delete:**

- `src/components/check/reading-status.tsx`. Move `ScreenshotDialog` and `ScreenshotThumb` to `src/components/scene/screenshot-dialog.tsx` first. `ReadingStatus` and `ReadingSkeleton` go.
- `src/components/check/outcome-alert.tsx`. Move `secondsUntil()` to the scene failure view.
- `src/components/flow/step-header.tsx` and every "Step x of 3" and stepper.
- `src/components/magicui/border-beam.tsx` and `src/components/magicui/blur-fade.tsx`. Remove the `BlurFade` usage in `stamped-sheet.tsx`. `number-ticker.tsx` stays (admin).
- `BandBadge`, `ThinProgress` (replaced by `TallyDots`) and `resultHeading()` in `verdict-summary.tsx`. Replace them with `VerdictHeadline({ check, as })`, which renders the coloured figure span plus the rest.
- `HowItWorks` in `compare-flow.tsx`.
- Public `Badge` usages: `pick.best` pill, coverage status pills, the header Saved count, the Saved "New" pill.
- Icons in buttons and rows (section 4).
- Boxed `Alert` for notices and confirmations on public pages.
- `Kbd` chips on the home page.
- The disabled "Compare price" bar while reading.

**Add:** `src/components/scene/*` (section 7.8), `src/lib/flow/decide-next.ts`, `src/lib/flow/scene-stage.ts`, `src/lib/use-interrupt.ts`. (The Arabic name outline, `src/components/shell/arabic-name-path.ts`, is not added: the Arabic name was retired with the rename on 18 Nov 2026.)

**Edit:**

| File | Change |
|---|---|
| `src/app/fonts.ts`, `src/app/layout.tsx` | Newsreader, both font variables, `themeColor` |
| `src/app/globals.css` | Tokens (section 3), radius, type utilities, `num`, `wdth-*` redefinitions, motion tokens, `--primary-hover` |
| `src/lib/motion.ts` | `BEAM_SETTLE`, `BEAM_DIP`, `BEAM_TIP`, `SWAY_AMP`, `SWAY_PERIOD`, `SHOW_AFTER`, `READ_HOLD`, `DURATION.set` |
| `src/hooks/use-check-flow.ts` | Section 6 |
| `src/components/check/compare-flow.tsx` | Home (section 8.3). `FlowLayout` for scene, question and result. The form for `details`. |
| `src/components/check/result-view.tsx`, `thin-result.tsx`, `not-covered-result.tsx` | Return slot content for `FlowLayout`. `ResultHeader` becomes notices plus `VerdictHeadline`. |
| `src/components/stamp/stamped-sheet.tsx` | `landingDelay`, `rounded-sm`, no BlurFade, text buttons below the sheet |
| `src/components/stamp/stamp.tsx` | `delay` prop. `useInterrupt` moves to `src/lib/use-interrupt.ts`. |
| `src/components/stamp/listing-plate.tsx` | Container-query sizes, text-safe zone |
| `src/components/result/verdict-summary.tsx` | `VerdictHeadline`, `TallyDots`. `shareSentence` and `todayLine` stay. |
| `src/components/result/sales-strip.tsx` | Sale dots `--foreground` |
| `src/components/result/sales-evidence.tsx` | Title in `type-title`, range caption under the closed trigger |
| `src/components/money/cost-row.tsx`, `share/share-actions.tsx`, `saved/save-button.tsx` | Text-only buttons |
| `src/components/data/data-notice.tsx` | Left-ruled `Notice` |
| `src/components/check/upload-card.tsx` | Home actions, window-level drag, kept-image row; no Kbd |
| `src/components/check/details-form.tsx`, `building-picker.tsx` | Rows, toggle group, no pills or icons |
| `src/components/home/from-the-data.tsx` | One sentence (section 8.3) |
| `src/components/shell/header.tsx`, `footer.tsx`, `logo.tsx`, `menu-sheet.tsx` | Sections 8.1, 8.2 and 2.5 |
| `src/components/share/share-page.tsx` | Section 8.7 |
| `src/components/coverage/*` | Section 8.8 |
| `src/app/how-it-works/page.tsx` | Section 8.9 |
| `src/components/saved/*` | Section 8.10 |
| `src/lib/copy.ts`, `docs/DESIGN.md` section 6 | Section 9 |

Packages: none added. `motion` 14.14 (`useTime`, `useSpring`, `useTransform`, `useAnimate`, `useReducedMotionConfig` are all present) and `next/font` cover everything.

---

## 11. Tests

**Update:**

- `tests/ui/check/flow-reducer.test.ts`: new phases and actions. There is no `outcome` phase and no `details` after a read.
- `tests/ui/check/compare-flow.test.tsx` and `tests/ui/flow/flow-chrome.test.tsx`: no step header, no reading skeleton, no disabled Compare bar. The scene's caption is the focus target.
- `tests/ui/result/result.test.tsx`: `VerdictHeadline` in place of `BandBadge`, tally dots, the read line with Edit.
- `tests/ui/check/building-picker.test.tsx`: row styling, and "Best match" as text.
- `tests/ui/shell/tokens.test.ts`: the new `LIGHT`/`DARK` values from section 3.2. Add `muted-foreground` on `accent`, `input` on `accent` and `stamp` on `background` to the pairs. Update the measured values (ink on background 15.98, input on background 3.74, input on dark card 4.14). Radius tokens: `--radius-md: 6px`, `--radius-xl: 12px`. The `num` utility regex now includes `lining-nums`.
- `tests/unit/copy.test.ts`: the `ADDED_KEYS` and `REMOVED` lists, and `result.h2` swapped for `result.headAbove`.
- `tests/ui/stamp/stamp.test.tsx`: the `delay` prop.
- `tests/ui/shell/header.test.tsx`: the Saved count as text.
- `tests/ui/how-it-works.test.tsx`, `tests/ui/coverage/coverage.test.tsx`, `tests/ui/real-data.test.tsx`: no pills, the figure.
- `tests/e2e/smoke.spec.ts`: the new journeys below.

**Add:**

- `tests/unit/flow/decide-next.test.ts`, one row per branch:
  - outcome not accepted
  - 3 missing (partial)
  - bedrooms missing
  - size missing
  - price missing
  - psf out of range
  - building text missing
  - stale match key
  - strong preselect (compare)
  - tie, towerCheck or areaCheck (ask building)
  - empty candidates (compare with null)
  - picked null (compare with null)
  - editedFields correct after a psf answer
- `tests/unit/flow/scene-stage.test.ts`: every phase and the timers.
- `tests/unit/scene/balance-geometry.test.ts`: `angleFor` (sign, clamp, ±5% gives at most 1.5°), `panOffsets` at 0 and ±9°, `dotLayout` caps at 24.
- A reduced-motion render test: with `matchMedia` mocked to reduce, every stage renders its static state, no `useTime` subscriber is mounted, and the settle renders final in one commit.
- E2E:
  - A clean read goes from the scene to the result with no form ever rendered (`[data-slot="details-form"]` absent).
  - A towerCheck read asks "Which building is this?", a row tap compares, and then the result shows.
  - A missing price asks one question, then compares.
  - `extract_busy` shows the countdown and then Try again.
  - Back from a result goes home. Edit, Compare price, Back shows the first result.
  - Every result shows the attribution and independence lines, and the sales list opens without any ask.

---

## 12. Acceptance checklist

Flow:

- [ ] A clean screenshot read goes to the stamped result with no form, no table and no skeleton shown.
- [ ] Only one question is ever on screen. It appears only for:
  - a not-a-sale outcome
  - 1 or 2 missing fields
  - a price per sq ft outside 300-6000
  - a tie, towerCheck or areaCheck, or no strong candidate
- [ ] 3 or more missing fields shows the partial state with [Type the details]. The form never opens by itself.
- [ ] Scene stages move only on real events. Middle captions show only after 300ms pending. Nothing waits on a timer except the 8s slow line, the 4s "Still comparing", the 400ms read hold and the 28s backstop.
- [ ] Settle to stamp at rest takes 900ms or less. Any tap, key, wheel or scroll jumps to the final state.
- [ ] Every failure in section 7.6 renders in the scene with its actions. Stop and Back keep the screenshot.
- [ ] Edit opens the form with every value. Compare price returns through the scene. Back and Forward behave as in section 6.5.

Data rules:

- [ ] The attribution (linked dataset and licence) and the independence line appear on every result, on /c and in the footer. No government logos.
- [ ] The sales list is never gated: open from 1024px, one tap on phones, on result and /c.
- [ ] Stale-data and data-loading notices, thin and not-covered results, the off-plan notice and stamp line, the adviser only with a partner, and the cost estimator all still work.
- [ ] No listing or price is invented on the home page. The noun "registered sales" is used throughout.

Visual:

- [ ] Newsreader and Archivo load self-hosted, 230 KB or less. No public text is below 14px, and no Newsreader below 16px.
- [ ] No pills, badges, steppers, numbered steps, boxed notices, icon buttons, gradients, beams, shimmer or skeleton pulses on public pages.
- [ ] Indigo appears only on the stamp, the diamond, the "This listing" bar and the logo mark.
- [ ] Verdict colour appears only on the headline's figure words (and in Saved, the Today line and admin charts).
- [ ] The plate text never touches the stamp at any width (check 1280 with stale data).

Accessibility:

- [ ] Contrast meets section 3.3 in both themes, and the tokens test passes.
- [ ] Visible 2px focus on every control. Everything is reachable by keyboard. Esc stops reading.
- [ ] Targets are 44px or more (rows 64px, bedroom buttons 48px).
- [ ] Focus moves to: the caption at scene start, each question heading, each failure heading, the verdict heading at the settle, and the form heading.
- [ ] Live region: start, slow, read, middle captions when shown, failures, verdict. The countdown is announced once.
- [ ] Reduced motion: a static equivalent for every animation, the extra reading sentence, identical focus and announcements.
- [ ] No horizontal scroll at 360, 375 and 390. Layout works at 768 and 1280. Text zoom to 200% clips no question control.

Performance:

- [ ] SVG, CSS and motion only. No new npm packages.
- [ ] CLS: the head slot is reserved (88px phone), the stage box has a fixed aspect, and From the data streams into a static placeholder.
- [ ] The sway is one motion value. It is unmounted under reduced motion and stops on question, failure and result.

Tests:

- [ ] Section 11 is green, including copy.test.ts with DESIGN.md section 6 updated.

---

## 13. Risks and owner sign-offs

1. **Auto-compare with no confirm step (sign-off).** A misread price or the wrong tower now produces a stamped, shareable card.
   - Mitigation: auto-compare only on the strict path in section 6.3. The read line with Edit sits right under the sentence. The building is named in the sentence, the read line and the provenance.
   - Track the share of results followed by an Edit. If it passes about 10%, add a building confirm for "possible" matches.
2. **One-tap building rows (sign-off).** This reverses DESIGN.md decision 12 in the scene. A mis-tap costs one Edit. The form keeps radios.
3. **"Weigh" in the headline and caption (sign-off).** It bends the one-verb rule. Buttons and the stamp still say compare.
4. **More checks per read.** Every clean read now posts `/api/checks` without a tap. Review the per-browser rate limit for checks and the meaning of admin stats (reads vs comparisons).
5. **Tilt reading.** The listing pan goes down when its price per sq ft is higher. Some may read "down" as "bad". The words and the stamp carry the verdict, and the copy never says heavier, cheaper or overpriced. Within ±5% the beam is near level.
6. **Dots and weight.** Eleven dots against one screenshot does not physically "weigh" more. The tilt follows price only. The labels make that explicit (price per sq ft on both sides).
7. **Fonts.** Check Newsreader's `lnum` (section 2.4) and the budget. Keep `adjustFontFallback` on for the LCP h1. There is no Arabic outline and no Markazi fallback: the Arabic name was retired with the rename on 18 Nov 2026.
8. **motion v14 details.** `useTime` and `useAnimate` ignore `MotionConfig`, so guard them by hand (section 7.8). Check SVG rotation about the pivot in Safari (the invisible centring rect makes `fill-box` safe). Stop the sway on unmount.
9. **Flow churn.** The reducer, URL steps, popstate handling and many tests change together. Build in this order:
   1. `decideNext`, `sceneStage` and the reducer, with tests.
   2. `FlowLayout`, the balance and the settle.
   3. The questions and failures.
   4. Restyling the result, form, /c, coverage, saved and how pages.
   5. Tokens and copy-deck sync, with tests.
10. **Phone question layout.** The stage collapses while a question is open (an expected change of view). Long building names wrap in rows. Never truncate.
11. **Warm paper plus a serif can drift toward the generic "AI editorial" look.** Guard rails: blue-black ink rather than brown, no italic, no terracotta, no drop caps, no mono labels. The signature is the balance and the stamp, not the paper.

---

## 14. Review changes (after the first build)

An adversarial review of the first build (screenshots at 390 and 1280, both themes) found these. Where this section and an earlier one disagree, this section wins.

**Layout and motion**

- The notices cell takes space only when a notice shows (`ResultNotices` renders nothing otherwise), so the verdict starts where the caption was, and the caption fading out over it does not move.
- Phones: the balance keeps its `-48px` offset while it fades out over the result, so it never drops at the handover. A not-covered result keeps the stage while the settle runs: the balance fades in place, then the stage height and its 20px gap close over 200ms (`SETTLE_AT.collapse`, 0.48s). Nothing under it jumps.
- The head reserves two caption lines on desktop during the scene (96px), as well as 88px on phones, so the read line under it never moves when a caption changes. Captions crossfade in one grid cell (200ms); the outgoing one is `aria-hidden`.
- The weighing caption names no building ("Weighing it against registered sales"), so it keeps to two lines on phones (section 2.3: headlines hold no building name). With no covered building chosen it is "Looking for registered sales", which claims nothing about its sales.
- The settle's interrupts are `pointerdown`, `keydown`, `wheel` and `touchstart` (not `scroll`). An interrupt now stops every running fade and jumps it to its final frame (`SettleIn` drives motion values and calls `jump()`); elements never remount, so focus is kept.
- Balance labels sit at 72% of the 4:5 box, 32% wide: between the pans (at full tilt) and the base, never on the base line.
- A failure dims the document on the pan too: `opacity .5` and a static `feColorMatrix saturate 0` filter.

**Flow**

- The scene' + "'" + 's heading is never empty. Straight after a read, a fast match or comparison passes under the reading caption (`quiet`); after a question, the form or a rerun, the next caption shows at once (the person just acted). Caption changes inside the scene are announced once by the flow; the first one is spoken by the focus move.
- The caption that fades out over the verdict is the one on screen just before the result, never an older one.
- A match or comparison pending for 4s shows "Still finding the building." or "Still comparing." with "Type the details instead" (the form with everything known). No answer in 20s (`COMPARE_BACKSTOP_MS`) aborts the request and shows "Couldn' + "'" + 't compare just now." with Try again and Edit details. `api.match` and `api.createCheck` take an `AbortSignal`.
- Back from a result or the form goes home with no screenshot kept, so a later "Type the details" never reuses or stamps the previous listing' + "'" + 's screenshot.
- Back from the scene after the read finished (a question, a comparison, a failed comparison, the partial read) keeps the screenshot with "Your screenshot is still here." and [Continue], which returns to the scene with everything read and answered, without reading again. Back while reading (or after a failed read) is Stop, as before.
- Stop on pasted text keeps the text: the paste box opens with it, says "Reading stopped. Your text is still here." and its button is Try again (the focus target).
- Results reached by Back or Forward restore what they were made from (`KeptResult.context`: source, payload, building pick, read values) and their own trim, so the read line' + "'" + 's label, Edit details and Search covered buildings use that result.
- Leaving the page mid-scene (Activity hides it) cancels everything in flight: a read becomes a stopped read, a match or comparison a resumable one. Nothing finishes, rewrites the URL or announces on another page. Object URLs are not revoked on hide.
- Esc stops reading while focus is in the flow (not inside a dialog).

**Words and type**

- The read line states what was read (or typed, or answered). When the compared building differs (another name, or another area), it adds "Compared with {building}." (`result.readCompared`), so a match in another area is visible instead of hidden behind "Read from your screenshot".
- Read figures carry their ink underline only while they set in; it dries 760ms later (CSS `read-ink`), and there is none under reduced motion, in questions, in failures or on the result, so a figure never looks like a link. A blank is named "not read yet" for screen readers.
- "AED" stays on the line of its amount and a size with "sq ft": the components join them with no-break spaces (`keepFiguresTogether`, and no-wrap spans in the read line). The deck strings and plain-text builders keep ordinary spaces.
- Display headings, questions and notes in Newsreader use typographic apostrophes and quotes (’ “ ”): `ask.*` headings and notes, `fail.*` titles, `ask.buildingSays`, `pick.noneSub`, `coverage.requestH2`.
- "In line" is set in ink (`--verdict-inline` equals the ink in both themes).
- The Arabic name, its Markazi preload and its fixed-width box were removed with the rename on 18 Nov 2026.
- The edit form' + "'" + 's Bedrooms select matches the inputs beside it: 48px, `--card` fill in both themes, 16px text.
- How Fairsquare compares: the contents list uses symmetric 12px padding and no minimum height, so wrapped entries keep the same gap as single-line ones.

**New copy keys** (DESIGN.md section 6): `scene.checking`, `scene.slowMatch`, `scene.kept`, `scene.keptText`, `read.stoppedText`, `read.blank`, `result.readCompared`.