# Fairsquare: production design spec

Status: ready for build. Date: 17 Nov 2026, updated 18 Nov 2026 for real data. Owner: design lead.

**Real data (18 Nov 2026).** The demo is gone. Sales come from the Dubai Land Department sales transactions published as open data on Data.Dubai, and docs/REAL_DATA.md wins wherever the two files differ. There is no demo mode, no sample listing, no example card, no iPhone frame and no fictional partner: the home page shows a real "From the data" panel, every result names its source and licence, and the adviser opt-in appears only when a real partner is configured. This file was updated to match (sections 2, 3, 4, 5.4, 6, 7 and 8). The design process record (sections 1.4 and 1.5) is kept as it was written.
**Redesign (18 Nov 2026).** The visual system and the compare flow are now specified in `docs/REDESIGN.md` ("The balance and the stamp"): typography, colour, space, motion, the processing scene, the one-question interrupt, the result and every page layout. That file overrides sections 1.2, 2 (tokens), 3 (pages), 4.2 (Magic UI), 5.1 (loading) and 7.2 (focus plan) here; read it first for anything visual or for the flow. This file still holds the copy deck (section 6, mirrored by `src/lib/copy.ts` and checked by `tests/unit/copy.test.ts`), the accessibility checklist (section 7) and the stamp, card and OG geometry (section 8).
**Rename (18 Nov 2026).** The product is now called Fairsquare (it was called Mizan). The name is one word: "Fairsquare" in sentences, titles and the wordmark, "FAIRSQUARE" on the stamp, and "fairsquare-" at the start of downloaded file names. The Arabic name and its footer gloss are gone; the logo mark (the balance inside a stamp) stays. The word "fair" appears only inside the name: never write it about a price, a value or a deal ("fair price", "fair value", "fairly priced", "fair deal", "fair market"), because valuing property is reserved to registered valuers (Dubai Executive Council Resolution 37 of 2015); the product compares with registered sales and says it is not a valuation. Internal identifiers keep "mizan" (the `mizan.ref` storage key, the history-state keys, the stamp font family names, the package, folder and service names) so saved data and tooling keep working. The design process record (section 1.4) keeps the old name where it quotes old copy.

Build target: Next.js 16 (App Router, `src/`), Tailwind CSS v4, shadcn/ui (Radix), three Magic UI components, lucide-react, Zod, motion/react, next/og. Deployed on Railway.

This file is the single source for look, layout, motion, copy and accessibility. Three files in the code mirror it and must stay in sync:

- `src/app/globals.css`: every colour, radius, shadow and motion token in section 2.
- `src/lib/copy.ts`: every user-facing string in section 6. The UI, the stamp, the card canvas, the OG image and the share text all read from it.
- `src/lib/stamp/geometry.ts`: the stamp geometry in section 8. The on-screen SVG, the canvas card and the OG image all draw from it.

API names, routes, data fields and env vars follow ARCHITECTURE.md. Points where this file and ARCHITECTURE.md disagreed were settled on 17 Nov 2026 and are listed in ARCHITECTURE section 0.2; this file was edited to match (endpoint `POST /api/checks`, schema file `src/lib/validation/fields.ts`, `APP_URL`, admin routes, explicit building requests, saved-listing undo and badge, CSV columns, the action-bar attribute on `<html>`).

Contents

1. Brief, principles and the design process record
2. Tokens: colour, type, spacing, radius, elevation, motion, icons, logo
3. Page specs and wireframes
4. Component inventory
5. States
6. Copy deck
7. Accessibility checklist and review-finding resolutions
8. Stamped card, stamp geometry and OG image

---

## 1. Brief, principles and the design process record

### 1.1 Brief recap

**Subject.** A price check for Dubai apartments. A buyer has a listing screenshot from a portal, an agent's WhatsApp message or an Instagram post. Fairsquare reads the building, bedrooms, size and price with Claude. The buyer confirms the building. Fairsquare compares the asking price per sq ft with the median of same-bedroom sales in that building over the last 12 months. It returns the buyer's own screenshot with a rubber stamp on it, for example "+14.0% vs median of 11 sales".

**Audience.** Expat buyers in Dubai, on phones, who arrive from a WhatsApp link that a friend, partner or agent forwarded. They are deciding on a large purchase, they distrust agents' numbers, and many read English as a second language. Desktop users are secondary.

**Primary job.** In two taps, tell the buyer how an asking price compares with recent sales in the same building, show the sales behind it, and give them a stamped card they can forward to the people they decide with.

**Secondary jobs.** Estimate the monthly cost, then offer one named mortgage broker through an explicit, unticked opt-in. Let the buyer save a listing and see new sales in that building later. Give the owner an admin area for stats, leads, building requests, sale registration and CSV import.

**Hard constraints.** All sales are registered Dubai Land Department transactions from the open data on Data.Dubai (REAL_DATA.md), and every result names that source and its licence. Wording is neutral: never "overpriced". There is no verdict below 5 sales. Screenshots are never stored. There is no user login.

**Subject vocabulary the design draws on.** The balance scale, which weighs an asking price against what apartments in the same building sold for. The physical things in this world are the title deed, the land registry, the clerk's rubber stamp, ink on paper, and the phone screenshot forwarded in a WhatsApp group. The design is built from those: paper-grey ground, petrol-blue registry ink for the interface, indigo stamp ink for the one verdict, and the buyer's own screenshot as the document that gets stamped.

### 1.2 Design principles

1. **The stamp is the only loud thing.** One element carries the brand and the verdict: the indigo rubber stamp landing on the buyer's screenshot. Everything around it is quiet paper and ink. No gradients, no glass, no decorative motion, no hype components.
2. **Evidence sits next to the claim.** Every percentage comes with its sale count, its date window, its source and its limits, on the same screen. The sales behind a result are one tap away, never hidden in a footer.
3. **Neutral, dated, labelled.** The wording never judges ("above recent sales", never "overpriced"). Every stamp carries a date. Every result names its source and the real dates of its sales, and the stamp says "REGISTERED SALES" with its window, so the claim survives a crop.
4. **One step per screen, primary action under the thumb.** On a phone, each step owns the screen and its main action sits in a bar at the bottom edge. Inputs are 16px, targets are at least 44px, and nothing scrolls by itself.
5. **Nothing leaves without consent.** Screenshots are not stored. The broker gets a name and number only after the buyer ticks an unticked box and presses a button that names the broker. Every saved thing can be withdrawn or deleted.

### 1.3 What we keep from the current app

These parts of `mizan-bot/web/index.html` already work. Port them as they are.

- The rubber stamp: indigo ink, -9 degree tilt, double rounded border, speckle knockout, multiply blend onto the screenshot.
- The balance-scale mark. (The prototype's Arabic name was dropped with the rename to Fairsquare.)
- The petrol-teal and indigo family, with light and dark tokens designed as pairs.
- Neutral band labels: "Above recent sales", "In line with recent sales", "Below recent sales", "Not enough sales", "Not covered yet".
- The result sentence that states asking AED per sq ft, the percentage, the count, the bedroom type, the building, the window and the median.
- The guardrails (updated by REAL_DATA.md section 7): 5 sales minimum, ready and off-plan sales compared separately, unusual sales (under half or over twice the median) left out, a 365-day window that ends at the latest sale in the data, plus or minus 5% band, a building is pre-selected only at match score 0.8 or above, match floor 0.62, generic words ignored in matching, "None of these" is always offered, AED per sq ft sanity range 300 to 6000.
- Error copy that states the cause and a way out, a Stop button while reading, and a manual path that always works.
- Consent: an unticked box naming one partner, versioned "optin-v1", name and phone shown only after the tick, and "Nothing is shared unless you tick the box and press send".
- Number details: the true minus sign (U+2212), en-GB dates ("17 Nov 2026"), AED digit grouping, tabular figures.
- A visible focus ring with an offset, reserved space for the card while it renders, safe-area insets.

### 1.4 Design process record (two passes)

> Historical record (17 Nov 2026). Where sections 1.4 and 1.5 discuss the demo labels, sample listings, the home example or the iPhone frame, those were removed for real data (REAL_DATA.md sections 8 and 10). The product was then called Mizan, and the record quotes its copy with that name; today the stamp reads "FAIRSQUARE" with the verdict word (IN LINE, ABOVE, BELOW or TOO FEW) and the share text ends with the source and the Fairsquare link (section 6.6).

The process follows frontend-design SKILL.md: draft a compact plan, review it against the brief and the generated-design tells, revise, and record what changed.

#### Pass 1: the first plan

- Colour: paper #F2F4F1, ink #13272C, petrol #0F4C5C, stamp indigo #3A37C9. Verdict colours amber #8F5100, green #22663F, blue #1F6AA8. Yellow demo pill. Focus ring in stamp indigo.
- Type: Archivo for headings and the stamp figure, Inter for body text. Tabular figures.
- Layout: mobile bottom tab bar (Check, Saved, Buildings) plus a sticky Share/Save bar on the result. Desktop in two columns, inputs on the left and the result on the right. The hero shows an iPhone mockup with a stamped example, on phones and desktop.
- Result: a verdict card, a stamped-card card, a sales card and a mortgage card.
- Motion: number-ticker counts the verdict % up from 0. blur-fade on each result section. The stamp lands. shine-border on the primary CTA. animated-list for saved alerts.
- Copy: nav "Check a listing", button "Check price", stamp "MIZAN CHECKED", share text "Checked on Mizan".

#### Review against the brief and the tells

To test for defaults, I ran the same prompt as a generic brief ("a property price checker for a city"). The generic answer is a teal fintech palette, a big number with a small label, a phone mockup in the hero, feature cards and a trust-blue CTA. Pass 1 shared too much with that answer. The table records each problem and the revision.

| # | Pass 1 choice | Problem against the brief or the tells | Revision |
|---|---|---|---|
| 1 | Archivo plus Inter | Inter is the default UI face, and two sans families with no clear contrast between them violate "one family or two, clearly distinct". | One family: Archivo variable. Its width axis (62 to 125) gives body text at 100, headings at 112 and the stamp figure at 70, all from one file. |
| 2 | Bottom tab bar plus a sticky result bar | Two fixed bars take about 130px of an 844px screen with the safe area, and the step's primary action cannot sit in the thumb zone. | A 56px top bar with Saved and a menu. The bottom edge belongs to the current step's primary action: "Compare price" on step 2, "Share card" and "Save and track" on step 3. |
| 3 | Green for "in line" | A traffic light. Green reads as "good deal" and amber as "warning", so the colour judges where the words are neutral. | A diverging set: ochre above, neutral slate in line, blue below, always with an arrow or equals icon and the text label. No green anywhere in the verdict. |
| 4 | number-ticker on the verdict % | Counting up from 0 dramatises a neutral number and competes with the stamp. It is a second orchestrated moment. | The verdict figure appears only in the stamp, and the stamp landing is the one moment. number-ticker is used only on admin KPIs. |
| 5 | blur-fade on each result section | "Fade-and-slide-up entrances on each section" is the named generic default. | blur-fade is used once, as the first 160ms of the stamp sequence (the sheet appears, then the stamp lands). |
| 6 | shine-border on the CTA, animated-list on Saved | Decoration in a money tool. Neither tells the user anything. | Cut. border-beam stays, but only while Claude reads (it shows that work is happening) and only under motion-safe. |
| 7 | iPhone mockup in the hero on all sizes | On a phone it is a phone inside a phone. A device mockup in the hero is a SaaS default. | iPhone frame on desktop only, where it explains that the input is a phone screenshot. On phones the example is a plain sheet. |
| 8 | Result as four bordered cards | The SaaS-card kit: identical rounded boxes for unequal content. | One elevated object per screen: the stamped sheet. The rest is unboxed text separated by spacing and hairlines, with accordions for detail. |
| 9 | "Check" in the nav, "Check price", stamp "CHECKED" | Mixed verbs. A stamp reading "CHECKED" on a forwarded card looks like approval of the listing. | One verb, compare: nav "Compare", button "Compare price", heading "Compared with 11 sales", stamp "MIZAN COMPARED" plus the date, share text "Compared on Mizan". |
| 10 | Verdict % shown in a pill, a big number, a sentence and the card | The same fact four times, which buries the stamp. | The stamp shows the figure. The page shows one band badge and one sentence. |
| 11 | Indigo focus ring and indigo tags | Indigo spread across the chrome stops being special. | Indigo is reserved for the stamp, the "This listing" chart marker and the logo mark. The focus ring and links are petrol. |
| 12 | Tapping a building option compares straight away (suggested by two reviewers) | A radio selection that triggers navigation breaks WCAG 3.2.2 On Input, and one mis-tap runs a comparison on the wrong tower. | Selection plus one button. When the match is strong the option is pre-selected, so the confirm is still one tap: "Compare price". |
| 13 | ALL-CAPS tags, middle-dot meta strings | Template chrome. | Sentence-case badges. Caps and separators appear only inside the stamp, where they are rubber-stamp vernacular. Meta strings become label and value pairs or short sentences. |

After the revision the plan has: a tool-first hero with no marketing sections above it; one typeface with a width axis used as the type treatment; paper-grey ground with petrol ink; one indigo stamp as the only memorable element; and the buyer's own screenshot as the main image. None of the five calibration clusters applies. The palette is not cream with terracotta, not near-black with acid green, not a broadsheet, not a card kit, and has none of the chrome tells.

#### What the ui-ux-pro-max searches returned and what we did with them

| Search | What came back | Decision |
|---|---|---|
| `--design-system "property price check consumer tool trust"` (variance 4, motion 2, density 5) | Hero-Centric pattern. Glassmorphism. Teal #0F766E with #14B8A6 and #0369A1 on #F0FDFA, mint border #99F6E4. Cinzel with Josefin Sans. GSAP scroll reveal. | Adopted: one primary CTA and a static hero under reduced motion. Rejected: glassmorphism (blur over listing screenshots hurts legibility, and blur should signal dismissal, not decorate), Cinzel and Josefin (luxury brochure language, wrong for sceptical buyers), scroll reveal (generic). The teal direction is confirmed, but we keep the desaturated petrol #0F4C5C, because the mint border is 1.26:1 and fails non-text contrast. |
| `"financial trust sans" --domain typography` | IBM Plex Sans ("Financial Trust"), Lexend with Source Sans 3, DM Sans. | IBM Plex Sans plus IBM Plex Sans Arabic is the fallback if a bilingual Arabic UI is added. Lexend and DM Sans are rejected as generic. |
| `"Archivo width axis variable" --domain google-fonts` | Archivo: wdth 62 to 125, wght 100 to 900, latin and latin-ext. | Confirms one Archivo file covers UI, headings and the stamp. |
| `"fintech trust teal neutral" --domain color` | Fintech gold and purple on dark; Real Estate teal (same as above). | Gold is rejected (developer-brochure language). Dark-first is rejected for this audience. |
| `"tool first hero demo" --domain landing` | Product Demo + Features: "keep the final product state available as static content". | Adopted: the home example is a static stamped sheet, never a live run through the user's form. |
| `"data entry tool trustworthy minimal" --domain style` | Minimalism & Swiss Style. | Adopted: grid, one accent, type-led hierarchy. Rejected: 0px radius and pure black. |
| `--stack nextjs`: "next/font variable font subset", "font og image metadata", "image optimization dynamic route" | Use next/font/google with a variable font on the body; `opengraph-image.tsx` and `generateMetadata`; next/image for images. | Adopted. User screenshots are blob URLs, so they render in a plain `<img>` with width and height set (next/image cannot optimise them). |
| `--stack shadcn`: "form field error drawer", "theme tokens dark mode css variables", "sonner toast drawer responsive" | FieldError with RHF Controller and Field (not the retired FormField); semantic variables under `:root` and `.dark` exposed with `@theme inline`; Sonner with `toast.success` and `toast.error`. | Adopted all three. |
| `--domain ux`: "multi-step progress back", "sticky bottom action bar safe area" | Progress Indicators ("Step 2 of 4"); Back Button (`history.pushState`, never `location.replace`); Sticky Navigation (pad content by the bar height). | Adopted: "Step 2 of 3" with each step in the URL, and `scroll-padding` for the top and bottom bars. |
| `--domain ux`: "skeleton long wait progress" | Only Progress Indicators and Truncation, no skeleton rule. | No verified match. Loading behaviour follows quick-reference `progressive-loading`, `loading-states` and `loading-buttons` instead. |
| `--domain ux`: "consent checkbox opt-in privacy", retried as "checkbox label submit" | 0 results, then Submit Feedback and Compact Label Overflow. | No verified consent rule. The consent design rests on quick-reference form rules (`input-labels`, `error-placement`, `submit-feedback`, `undo-support`) and the fixed decisions. |
| `--domain chart`: "distribution single value comparison", retried as "dot plot strip comparison" | Sankey and bar chart, then radar and box plot (box plot needs 20 or more points per group). | No verified match for 3 to 15 points. Fallback: a one-row dot strip with the median and the plus or minus 5% band, following quick-reference `data-table`, `direct-labeling`, `screen-reader-summary` and `responsive-chart`. |

### 1.5 Where the reviewers disagreed, and the decision

| Topic | Positions | Decision and reason |
|---|---|---|
| Counting up the verdict % | product-flow: number-ticker on the %. visual-copy: never. | Never. The stamp landing is the one moment, and a counting number dramatises a neutral fact. |
| Verdict colours | product-flow: keep amber, green, blue. visual-copy: neutral icons. a11y: darken for contrast. | Diverging ochre, slate and blue, darkened for AA, always with an icon and text. |
| Focus ring colour | a11y: stamp indigo. visual-copy: petrol. | Petrol. Indigo stays exclusive to the stamp. Petrol is 8.6:1 on paper. |
| Tap an option to compare | visual-copy and product-flow: yes. | No. Select, then press "Compare price" (WCAG 3.2.2). The strong-match pre-select keeps it to one tap. |
| Mobile navigation | a11y and visual-copy: bottom tab bar. product-flow: minimal header. | 56px top bar with a labelled Saved link and a menu. The bottom edge is reserved for the step's action bar. Two fixed bars would cost 14% of the screen. |
| Sticky result actions | a11y and product-flow: yes. | Yes. This works because there is no bottom tab bar. |
| iPhone frame | product-flow: beside or under the hero on phones. visual-copy: desktop and /c. | Desktop home only. The /c page shows a listing plate, not a phone screenshot, so a phone frame would be false. |
| Example on first load | visual-copy: keep example-first. a11y and product-flow: never run it through the live form. | A static example sheet below the tool. It never touches the form, never scrolls, and cannot be saved or sent to a broker. |

---

## 2. Tokens

### 2.1 Colour

#### Base palette

| Name | Hex | Role |
|---|---|---|
| Paper | #F2F4F1 | Page ground. Cool grey-green, not cream. |
| Sheet | #FFFFFF | Raised surfaces: inputs, drawers, the listing plate. |
| Ink | #13272C | Text. A deep blue-green, never #000 or #111. |
| Petrol | #0F4C5C | Registry ink: primary buttons, links, focus ring, chart dots. |
| Stamp | #3A37C9 | Rubber-stamp ink. Only the stamp, the "This listing" marker and the logo mark. |

#### Semantic tokens mapped to shadcn variables

Hex is valid in Tailwind v4 (opacity modifiers use `color-mix`). Converting to OKLCH is optional.

| Variable | Light | Dark | Use |
|---|---|---|---|
| `--background` | #F2F4F1 | #0D1517 | Page |
| `--foreground` | #13272C | #E4ECEA | Body text |
| `--card` | #FFFFFF | #142024 | Drawers, sheets, plate, admin panels |
| `--card-foreground` | #13272C | #E4ECEA | |
| `--popover` | #FFFFFF | #142024 | Popover, menu, select list |
| `--popover-foreground` | #13272C | #E4ECEA | |
| `--primary` | #0F4C5C | #6BBBCB | Primary button, links, selected option border |
| `--primary-foreground` | #FFFFFF | #0D1517 | Text on primary |
| `--secondary` | #E3EAE7 | #1E2E33 | Secondary button fill |
| `--secondary-foreground` | #13272C | #E4ECEA | |
| `--muted` | #E8ECE8 | #1B2A2F | Skeletons, admin table header |
| `--muted-foreground` | #53646A | #93A5A7 | Helper text, captions |
| `--accent` | #DCECEF | #173840 | Hover and selected fills (selected building option, menu hover) |
| `--accent-foreground` | #0F4C5C | #E4ECEA | |
| `--destructive` | #B3261E | #F2867E | Delete actions, field errors |
| `--destructive-foreground` | #FFFFFF | #0D1517 | Text on destructive buttons (shadcn's Tailwind v4 theme may omit it; add it) |
| `--border` | #D5DCD7 | #27383D | Decorative hairlines only: dividers, table rules |
| `--input` | #7A8B8E | #5E767B | Borders of inputs, selects, checkboxes, radios, outline buttons |
| `--ring` | #0F4C5C | #6BBBCB | Focus ring |
| `--chart-1` | #0F4C5C | #6BBBCB | Sale dots, main admin series |
| `--chart-2` | #3A37C9 | #A3A1FF | "This listing" diamond |
| `--chart-3` | #13272C | #E4ECEA | Median line |
| `--chart-4` | #D3E6EA | #1E3A42 | Fill of the plus or minus 5% "in line" band (area, not a mark) |
| `--chart-5` | #8F5100 | #E9A64A | Secondary admin series (read failures) |
| `--stamp` | #3A37C9 | #A3A1FF | Stamp ink on UI surfaces. The stamp on a screenshot or plate always uses #3A37C9, because the sheet is paper in both themes. |
| `--verdict-above` | #8F5100 | #E9A64A | Text and icon of "Above recent sales" |
| `--verdict-inline` | #45575C | #A9B9BC | Text and icon of "In line with recent sales" |
| `--verdict-below` | #1D5E96 | #6CB1EC | Text and icon of "Below recent sales" |
| `--notice` | #FFF4DC | #3A2A0C | Caveat and warning Alert fill (off-plan, contact details) |
| `--notice-foreground` | #7A4B00 | #F2C46B | |

#### Rules of use

- Indigo (`--stamp`) appears only in the stamp, the chart's "This listing" diamond, the "This listing" row marker and the logo mark. Never on buttons, tags, focus rings or badges.
- Verdict colours appear only as text and icon colour in the band badge and in the admin verdict chart. Never as large fills. Direction is always also given by an icon (ArrowUp, Equal, ArrowDown) and the label.
- Coverage status ("Enough ready sales", "Enough off-plan sales", "Too few sales") uses neutral badges, never verdict colours.
- `--border` is decorative. Any boundary that identifies a control uses `--input` (3:1 or more).
- The stamped sheet and the listing plate stay paper-light in dark mode, like a photo of a document. Dark mode adds a 1px white/6% ring around them instead of a shadow.
- No gradients anywhere. No raw hex in components: use the semantic utilities (`bg-primary`, `text-verdict-above`).

#### Contrast, measured with the WCAG 2 formula

Script: a throwaway contrast checker (not included in this repository). Text needs 4.5:1. Control boundaries, focus rings and meaningful marks need 3:1.

| Pair | Light | Dark | Needs |
|---|---|---|---|
| foreground on background | 14.02 | 15.38 | 4.5 |
| foreground on card | 15.51 | 13.86 | 4.5 |
| muted-foreground on background | 5.59 | 7.20 | 4.5 |
| muted-foreground on card | 6.18 | 6.48 | 4.5 |
| muted-foreground on muted | 5.18 | 5.77 | 4.5 |
| primary-foreground on primary | 9.51 | 8.44 | 4.5 |
| primary (link) on background | 8.60 | 8.44 | 4.5 |
| accent-foreground on accent | 7.83 | 10.43 | 4.5 |
| destructive on card | 6.54 | 6.73 | 4.5 |
| destructive-foreground on destructive | 6.54 | 7.47 | 4.5 |
| input border on card | 3.55 | 3.45 | 3.0 |
| input border on background | 3.21 | 3.83 | 3.0 |
| ring on background | 8.60 | 8.44 | 3.0 |
| stamp on card | 8.17 | 7.21 | 3.0 (mark), 4.5 (stamp text) |
| verdict-above on card / background / muted | 6.28 / 5.68 / 5.26 | 7.94 / 8.81 / 7.06 | 4.5 |
| verdict-inline on card / background / muted | 7.58 / 6.85 / 6.35 | 8.20 / 9.11 / 7.30 | 4.5 |
| verdict-below on card / background / muted | 6.79 / 6.14 / 5.69 | 7.24 / 8.04 / 6.44 | 4.5 |
| notice-foreground on notice | 6.78 | 8.50 | 4.5 |
| chart-1 dots on card | 9.51 | 7.60 | 3.0 |
| Card footer: white on petrol | 9.51 | n/a | 4.5 |
| Card footer: #C8E2E7 on petrol | 7.01 | n/a | 4.5 |
| `--border` on card (decorative only) | 1.40 | 1.36 | none |

The old values that failed are fixed: verdict above #A85F00 (4.09:1) is now #8F5100, in line #2B7A4B (4.41:1) is now slate #45575C, and input borders (1.26 to 1.51:1) now use `--input`.

#### globals.css skeleton

```css
@import "tailwindcss";
@import "tw-animate-css";
@custom-variant dark (&:is(.dark *));

:root {
  --radius: 0.5rem;
  --background: #F2F4F1; --foreground: #13272C;
  --card: #FFFFFF; --card-foreground: #13272C;
  --popover: #FFFFFF; --popover-foreground: #13272C;
  --primary: #0F4C5C; --primary-foreground: #FFFFFF;
  --secondary: #E3EAE7; --secondary-foreground: #13272C;
  --muted: #E8ECE8; --muted-foreground: #53646A;
  --accent: #DCECEF; --accent-foreground: #0F4C5C;
  --destructive: #B3261E; --destructive-foreground: #FFFFFF;
  --border: #D5DCD7; --input: #7A8B8E; --ring: #0F4C5C;
  --chart-1: #0F4C5C; --chart-2: #3A37C9; --chart-3: #13272C; --chart-4: #D3E6EA; --chart-5: #8F5100;
  --stamp: #3A37C9;
  --verdict-above: #8F5100; --verdict-inline: #45575C; --verdict-below: #1D5E96;
  --notice: #FFF4DC; --notice-foreground: #7A4B00;
  --elev-sheet: 0 1px 2px rgb(19 39 44 / 0.08), 0 16px 40px -16px rgb(19 39 44 / 0.35);
  --elev-overlay: 0 24px 56px -12px rgb(19 39 44 / 0.40);
  --scrim: rgb(13 21 23 / 0.56);
  --header-h: 56px;
  --action-bar-h: 0px; /* 72px below 1024px while <html data-action-bar> is set by <ActionBar> */
}
@media (min-width: 1024px) { :root { --header-h: 64px; } }

.dark {
  --background: #0D1517; --foreground: #E4ECEA;
  --card: #142024; --card-foreground: #E4ECEA;
  --popover: #142024; --popover-foreground: #E4ECEA;
  --primary: #6BBBCB; --primary-foreground: #0D1517;
  --secondary: #1E2E33; --secondary-foreground: #E4ECEA;
  --muted: #1B2A2F; --muted-foreground: #93A5A7;
  --accent: #173840; --accent-foreground: #E4ECEA;
  --destructive: #F2867E; --destructive-foreground: #0D1517;
  --border: #27383D; --input: #5E767B; --ring: #6BBBCB;
  --chart-1: #6BBBCB; --chart-2: #A3A1FF; --chart-3: #E4ECEA; --chart-4: #1E3A42; --chart-5: #E9A64A;
  --stamp: #A3A1FF;
  --verdict-above: #E9A64A; --verdict-inline: #A9B9BC; --verdict-below: #6CB1EC;
  --notice: #3A2A0C; --notice-foreground: #F2C46B;
  --elev-sheet: 0 0 0 1px rgb(255 255 255 / 0.06), 0 16px 40px -16px rgb(0 0 0 / 0.6);
  --elev-overlay: 0 0 0 1px rgb(255 255 255 / 0.06), 0 24px 56px -12px rgb(0 0 0 / 0.7);
  --scrim: rgb(0 0 0 / 0.64);
}

@theme inline {
  --font-sans: var(--font-archivo), ui-sans-serif, system-ui, sans-serif;
  --font-stamp-condensed: "Mizan Stamp Condensed", "Arial Narrow", sans-serif;
  --font-stamp-wide: "Mizan Stamp Wide", Arial, sans-serif;
  --color-background: var(--background); --color-foreground: var(--foreground);
  --color-card: var(--card); --color-card-foreground: var(--card-foreground);
  --color-popover: var(--popover); --color-popover-foreground: var(--popover-foreground);
  --color-primary: var(--primary); --color-primary-foreground: var(--primary-foreground);
  --color-secondary: var(--secondary); --color-secondary-foreground: var(--secondary-foreground);
  --color-muted: var(--muted); --color-muted-foreground: var(--muted-foreground);
  --color-accent: var(--accent); --color-accent-foreground: var(--accent-foreground);
  --color-destructive: var(--destructive); --color-destructive-foreground: var(--destructive-foreground);
  --color-border: var(--border); --color-input: var(--input); --color-ring: var(--ring);
  --color-chart-1: var(--chart-1); --color-chart-2: var(--chart-2); --color-chart-3: var(--chart-3);
  --color-chart-4: var(--chart-4); --color-chart-5: var(--chart-5);
  --color-stamp: var(--stamp);
  --color-verdict-above: var(--verdict-above); --color-verdict-inline: var(--verdict-inline); --color-verdict-below: var(--verdict-below);
  --color-notice: var(--notice); --color-notice-foreground: var(--notice-foreground);
  --radius-sm: 4px; --radius-md: 8px; --radius-lg: 8px; --radius-xl: 16px;
  --shadow-sheet: var(--elev-sheet); --shadow-overlay: var(--elev-overlay);
}

@utility wdth-heading { font-variation-settings: "wdth" 112; }
@utility wdth-figure { font-variation-settings: "wdth" 88; }
@utility num { font-variant-numeric: tabular-nums; }

/* The action bar sets data-action-bar on <html> (not <body>): scroll-padding lives on html, and custom properties only inherit downward. */
@media (max-width: 1023px) { html[data-action-bar] { --action-bar-h: 72px; } }
html { scroll-padding-top: calc(var(--header-h) + 8px); scroll-padding-bottom: calc(var(--action-bar-h) + env(safe-area-inset-bottom) + 8px); }
body { background: var(--background); color: var(--foreground); font-size: 1rem; line-height: 1.55; }
button, a, [role="button"], input, select, textarea, label { touch-action: manipulation; }
:focus-visible { outline: 2px solid var(--ring); outline-offset: 2px; }

@media (prefers-reduced-motion: reduce) {
  *, ::before, ::after {
    animation-duration: 0.01ms !important; animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important; scroll-behavior: auto !important;
  }
}
```

### 2.2 Typography

**One family: Archivo (variable, wght 100 to 900, wdth 62 to 125), Omnibus-Type, OFL.** Archivo is a plain grotesque built for print and screen, with the slightly mechanical forms of official paperwork. Its width axis is the type treatment: normal width for reading, slightly wide for headings and the wordmark, and condensed for the stamp figure, so the stamp's numbers look cut from the same metal as the UI.

```ts
// src/app/fonts.ts
import { Archivo } from "next/font/google";
export const archivo = Archivo({
  subsets: ["latin"],
  axes: ["wdth"],          // wght is variable by default
  display: "swap",
  variable: "--font-archivo",
});
// layout.tsx: <html className={archivo.variable}> ... <body className="font-sans">
```

**Stamp, card and OG fonts.** Canvas, Satori (next/og) and the stamp SVG cannot rely on variation axes. Ship static instances made once from the same Archivo variable TTF with fonttools, subset to Latin capitals, digits and `+ − % . , / ( ) : -` and space, as WOFF (Satori reads TTF, OTF and WOFF, not WOFF2):

| File (in `src/assets/fonts/`, copied to `public/fonts/`) | Instance | Used by |
|---|---|---|
| `archivo-stamp-condensed.woff` ("Mizan Stamp Condensed") | wdth 70, wght 780 | Stamp figure |
| `archivo-stamp-wide.woff` ("Mizan Stamp Wide") | wdth 125, wght 700 | Stamp header and lines |
| `archivo-400.woff`, `archivo-600.woff` (full Latin) | wdth 100 | OG image text, card footer fallback |

```
fonttools varLib.instancer Archivo[wdth,wght].ttf wdth=70 wght=780 -o stamp-condensed.ttf
pyftsubset stamp-condensed.ttf --unicodes="U+0020-005A,U+2212" --flavor=woff --output-file=archivo-stamp-condensed.woff
```

Register the stamp faces with `@font-face` (`font-display: block`, preloaded only on result and /c routes) for the SVG stamp, and with the `FontFace` API before any canvas drawing.

**Arabic.** The product has an English name only (Fairsquare), so no Arabic text and no Arabic webfont ship. If an Arabic UI is added later, switch the whole system to IBM Plex Sans with IBM Plex Sans Arabic.

**Numerals.** Every price, size, percentage, count, date in a table and KPI uses `num` (tabular-nums). Check in the first build that Archivo's tabular figures align in the sales table. If they do not, switch to IBM Plex Sans.

**Type scale.** The classic scale from The Elements of Typographic Style: 14, 16, 18, 21, 24, 30, 36, 48. Nothing in the DOM is smaller than 14px. Only the stamp, the card canvas and the OG image (which are images) use other sizes.

| Token (Tailwind) | rem / px | Line height | Weight | Width | Use |
|---|---|---|---|---|---|
| `text-caption` | 0.875 / 14 | 1.45 | 400, 500 for labels | 100 | Helper text, captions, provenance, table cells on phones, chart ticks |
| `text-body` | 1 / 16 | 1.55 | 400 | 100 | Body, inputs (always 16px below md), buttons |
| `text-lead` | 1.125 / 18 | 1.5 | 400 | 100 | The verdict sentence, the home lead on desktop |
| `text-title` | 1.3125 / 21 | 1.3 | 640 | 106 | h3, drawer titles, list item titles |
| `text-heading` | 1.5 / 24 | 1.2 | 680 | 112 | h2: step headings, page sections |
| `text-display-sm` | 1.875 / 30 | 1.1 | 720 | 112 | h1 on phones; money figures (monthly cost, admin KPIs) at wdth 88 |
| `text-display-md` | 2.25 / 36 | 1.08 | 720 | 112 | h1 from 768px |
| `text-display` | 3 / 48 | 1.04 | 720 | 112 | Home h1 from 1024px only |

Rules:

- Labels and field labels: 14px weight 500 in `--foreground`, sentence case. Field labels are not muted.
- Headings: `text-wrap: balance`, tracking -0.01em at 30px and up, never all caps.
- Body measure: max 65ch (prose pages max-w-[65ch]; forms max-w-md).
- Consent text: 16px body size, not small print.
- No italics for emphasis, no single accented word in a headline, no tracked caps outside the stamp.

### 2.3 Spacing and layout

- 4px base, Tailwind default steps. Use 4, 8, 12, 16, 24, 32, 48, 64, 96.
- Rhythm: 8 to 12 inside a group (label to field, field to helper), 24 between groups, 32 between sections on phones and 48 on desktop.
- Page gutter: `max(16px, env(safe-area-inset-left/right))` below 768px, 24px from 768px, 32px from 1024px.
- Container: 1200px of content, centred (`max-w-[1264px]` with the 32px desktop gutters, so at 1280 the content runs from x 40 to 1240, RESULT_SPEC 3.2). Desktop grid: 12 columns, 24px gap.
- Breakpoints (Tailwind defaults): below 768px one step per screen; 768 to 1023px a single centred column, max-w 640px, still one step per screen; 1024px and up two columns of 6 and 6.
- Minimum heights: `min-h-dvh` on the shell, never `100vh`.
- z-index scale: content 0, sticky header 30, sticky action bar 30, popover and menu 40, drawer, sheet and dialog 50, toasts 60, skip link 70.
- Fixed offsets: the header is `--header-h` (56px, 64px from 1024px). While the sticky action bar is mounted, `<ActionBar>` sets `data-action-bar` on `<html>` (removed on unmount), which sets `--action-bar-h: 72px` below 1024px; main content is padded by `calc(var(--action-bar-h) + env(safe-area-inset-bottom))`.

### 2.4 Radius by hierarchy

| Token | Value | Applies to |
|---|---|---|
| `rounded-sm` | 4px | Checkbox, table highlight bar, progress track |
| `rounded-md` (and `rounded-lg`) | 8px | Inputs, selects, buttons, textarea, alerts, popovers, menus, building option cards, admin panels, the desktop drop area |
| `rounded-xl` | 16px | The hero objects only: the stamped sheet, the example sheet, the listing plate, the screenshot thumbnail, drawer and sheet top corners, dialogs |
| `rounded-full` | 999px | Badges, the step number discs, the slider thumb |
| Stamp geometry | own | Outer border radius w/18, inner w/30 (section 8) |

Controls are 8, documents are 16, markers are round. Nothing else.

### 2.5 Elevation

| Level | Token | Used by |
|---|---|---|
| 0, flat | none | Page, forms, lists, evidence, admin tables. Separation comes from spacing and `--border` hairlines. |
| 1, document | `shadow-sheet` | The stamped sheet, the example sheet, the listing plate, the screenshot thumbnail. Paper on a desk. |
| 2, overlay | `shadow-overlay` plus `--scrim` | Drawer, sheet, dialog, alert dialog, popover, dropdown, toast. |

Sticky bars have no shadow. They use an opaque `--background` fill and a 1px `--border` edge. No backdrop blur anywhere: blur would signal a dismissible layer.

### 2.6 Motion

**Tokens**

| Token | Value | Use |
|---|---|---|
| `--dur-press` | 80ms | Pressed state (background shade, option cards and chips scale to 0.98) |
| `--dur-fast` | 140ms | Hover, colour and state changes, all exits |
| `--dur-base` | 200ms | Popover, menu and dialog enter; accordion height |
| `--dur-sheet` | 280ms | Drawer and sheet enter (exit 180ms, about 65%) |
| `--ease-out` | cubic-bezier(0.2, 0.8, 0.2, 1) | Things arriving |
| `--ease-in` | cubic-bezier(0.4, 0, 1, 1) | Things leaving |
| Stamp spring | motion/react `{ type: "spring", stiffness: 700, damping: 32, mass: 0.8 }` | The stamp landing only. CSS fallback `cubic-bezier(0.34, 1.4, 0.64, 1)` over 220ms. |

**The one orchestrated moment: the stamp lands.** It runs after the user presses "Compare price", and once on the first view of a /c page. Nowhere else.

| Time | What happens |
|---|---|
| 0ms | Focus moves to the result heading. It does not wait for the animation. The live region announces the verdict sentence. |
| 0 to 160ms | The sheet (the user's screenshot or the listing plate) fades in through `blur-fade` (blur 4px to 0, no y offset). On desktop the sheet is already visible from step 2, so this step is skipped. |
| 120 to 340ms | The stamp goes from opacity 0, scale 1.14, rotate -13 degrees to opacity 0.92, scale 1, rotate -9 degrees on the stamp spring. Transform and opacity only. |
| 180 to 300ms | Impact: the sheet moves down 1.5px and back. On coarse pointers where `navigator.vibrate` exists (Android), one 12ms pulse. Never on iOS, never more than once. |

Rules: the sequence is interruptible (any tap, scroll or key jumps to the final state), never blocks input, and never uses an animation-end event for correctness. The home example and Saved reopen show the stamp in its final state.

**Other allowed motion, all answering an action:** drawer and sheet slide, dialog fade and scale from 0.98, accordion open and close, chevron rotation, pressed states, the border-beam while Claude reads, and the admin KPI number-ticker on first load. No entrance animations on sections, no hover lifts on cards, no parallax, no confetti.

**Reduced motion.** Wrap the app in `<MotionConfig reducedMotion="user">`. With `prefers-reduced-motion: reduce`:

- The stamp renders at its final state. No blur-fade, no impact, no vibration.
- border-beam is replaced by a static 2px `--primary` border, and the status text carries the meaning.
- number-ticker renders the final value.
- Skeletons do not pulse. Spinners are static, with text next to them.
- All scrolling uses `scrollIntoViewSafe(el)`, which passes `behavior: "auto"` under reduced motion. Nothing scrolls without a user action.

### 2.7 Icons

lucide-react only. Stroke width 1.75. Two sizes: 16px inline with text, 20px in buttons and the header. An icon next to visible text gets `aria-hidden`. An icon-only button gets an `aria-label` and a 44px hit area. Never emoji.

| Meaning | Icon |
|---|---|
| Choose a screenshot | `ImageUp` |
| Paste listing text | `ClipboardPaste` |
| Type the details | `PenLine` |
| Loading | shadcn `Spinner` (uses `Loader2`) |
| Remove screenshot | `X` |
| View screenshot larger | `Expand` |
| Above, in line, below | `ArrowUp`, `Equal`, `ArrowDown` |
| How Fairsquare compares | `CircleHelp` |
| Share card | `Share2` |
| Download card | `Download` |
| Copy link | `Link` |
| Send on WhatsApp | `Send` (no WhatsApp logo; the label names it) |
| Hide contact details | `Crop` |
| Save and track / Tracking | `Bookmark` / `BookmarkCheck` |
| Monthly cost | `Calculator` |
| Coverage, building options | `Building2` |
| Search | `Search` |
| Back | `ChevronLeft` |
| Accordion | `ChevronDown` (rotates 180 degrees when open) |
| Menu | `Menu` |
| Theme | `Sun`, `Moon`, `Monitor` |
| Success | `CircleCheck` |
| Field error, caveat | `TriangleAlert` |
| Read failure | `CircleAlert` |
| Data notices (stale data, data loading, off-plan, size) | `Info` |
| Delete | `Trash2` |
| Reveal phone (admin) | `Eye` |
| CSV import / export (admin) | `Upload` / `FileDown` |

Do not use `Scale` (the logo owns that symbol), `Sparkles` (AI hype) or `ShieldCheck` (implies certification).

### 2.8 Logo and wordmark

- **Mark:** a miniature of the stamp, in one colour (`--stamp`): a rounded rectangle with a double border (outer 2px, inner 1px, inset 3px, radii 6 and 4 on a 32 by 32 grid) with the balance scale drawn inside in 1.75px strokes. Upright in the UI. The favicon and apple-touch-icon use the same mark rotated -9 degrees on paper.
- **Wordmark:** "Fairsquare" in Archivo, wdth 112, wght 760, 20px, sentence case, no tracking, `--foreground`.
- **No Arabic name:** the lockup is the mark and the English wordmark only, on every screen size (the Arabic name was dropped with the rename to Fairsquare). The footer shows the wordmark alone.
- The brand link is `<Link href="/" aria-label="Fairsquare home">`.

---

## 3. Page specs and wireframes

Wireframes show 390px (mobile) and 1280px (desktop). Boxes made of `+ - |` are surfaces. `[Label]` is a button, `( )` a radio, `[ ]` a checkbox or input, `(Badge)` a badge. Icon names are shortened inside buttons (`Bk` is Bookmark, `[s]` is the scale glyph, `<>` a drawn diamond). Measurements are in CSS px.

### 3.0 App shell

**Header, mobile (56px, sticky):**

```
390
+--------------------------------------------+
| [mark] Fairsquare         [Bk Saved 2] [=] |
+--------------------------------------------+
  mark 28   wordmark                Saved link  Menu (44x44)
```

- Saved is a link with the Bookmark icon, the label "Saved" and, when there are new sales, a count badge. Its accessible name includes the count: "Saved, 2 listings have new sales".
- Below 375px the Saved link padding drops to 12px. Test at 360px: everything must fit on one row.
- Menu opens a shadcn `Sheet` from the right: Compare a listing, Saved, Coverage, How Fairsquare compares, Privacy, Theme (Light / Dark / System).
- No sync bar.

**Header, desktop (64px, sticky):**

```
1280
+--------------------------------------------------------------------------------------------------+
| [mark] Fairsquare    Compare   Saved 2   Coverage            How Fairsquare compares     [theme] |
+--------------------------------------------------------------------------------------------------+
```

- Links use `aria-current="page"` with a 2px `--primary` underline and weight 600.
- Admin never appears in public navigation.

**Footer (all public pages):** one column on phones, three on desktop. Contents: How Fairsquare compares, Coverage, Privacy; the attribution ("Source: Dubai Land Department sales transactions, published as open data on Data.Dubai and used under the Dubai Open Data Licence.", with the dataset and licence names linked to the manifest's URLs) and the independence line ("Fairsquare is independent. It is not affiliated with or endorsed by the Dubai Land Department or the Government of Dubai."), REAL_DATA.md section 9, with no logos; "Not a valuation."; "Fairsquare uses Claude, Anthropic's AI, to read screenshots."; the wordmark (English only). 14px, `--muted-foreground`.

**Always mounted in the root layout:**

- A skip link, "Skip to content", visible on focus, targeting `<main id="main" tabIndex={-1}>`.
- `<LiveRegion>`: one `role="status" aria-live="polite" aria-atomic="true"` and one `aria-live="assertive"` region, both `sr-only`, fed by a `useAnnounce()` hook.
- Sonner `<Toaster />`: `position="top-center"` below 768px (so it never covers the action bar), `bottom-right` on desktop, `richColors` off, 4 second duration.
- `<MotionConfig reducedMotion="user">`, next-themes (`attribute="class"`, `defaultTheme="system"`).
- The public config from the server in a context: the rules, `leadsEnabled`, the partner (or null) and the data status (`dataFrom`, `dataThrough`, the source and licence URLs, `stale`).

**Step header (steps 2 and 3, phones and tablets):**

```
+--------------------------------------------+
| [< Back]                      Step 2 of 3  |   48px, in page flow, not sticky
| Check the details                          |   h2 24px, tabIndex -1 (focus target)
+--------------------------------------------+
```

The progress is an `<ol aria-label="Progress">` with three items ("Add a screenshot", "Check the details", "See the comparison"). The current item has `aria-current="step"`. Visually it shows "Step 2 of 3". On desktop it shows as three numbered discs joined by a 1px line, above the left column. The numbers are legitimate here: the content is a sequence.

**Sticky action bar (steps 2 and 3, below 1024px):** 72px plus `env(safe-area-inset-bottom)`, opaque `--background`, 1px top `--border`, buttons 48px tall, 16px side padding. It holds the step's primary action only.

### 3.1 Home and step 1: the hero is the tool

Route `/`. The page opens on the tool. There is no marketing section above it, no auto-run and no auto-scroll.

**Mobile 390:**

```
+--------------------------------------------+
| [mark] Fairsquare         [Bk Saved] [=]   |
+--------------------------------------------+
|                                            |
| Compare a listing's price with recent      |  h1 30/1.1, wdth 112
| sales in the same building                 |
|                                            |
| Add a screenshot from a property portal,   |  16/1.55
| an agent's WhatsApp or Instagram.          |
| Fairsquare compares its price per sq ft    |
| with sales in that building.               |
| Apartments for sale in Dubai.              |  14, muted
|                                            |
| (i) Fairsquare's sales data currently runs |  only when the data is stale
|     to 1 Sep 2026. Sales registered ...    |  (section 5.4), Info icon
|                                            |
| +----------------------------------------+ |
| |  [ImageUp]  Choose a screenshot        | |  primary, 52px, full width
| +----------------------------------------+ |
| [Paste listing text]   [Type the details]  |  outline, 44px, 2 columns, gap 8
|                                            |
| Fairsquare uses Claude, Anthropic's AI, to |  14, muted
| read your screenshot. It isn't stored.     |
| Privacy                                    |
|- - - - - - - - - - - - - - - - - - - - - - |  first viewport ends about here
| From the data                              |  h2 24
| The building with the most registered      |  14, muted
| sales of ready 2-bed apartments in the 12  |
| months to 10 Nov 2026.                     |
| Test Tower A                               |  title 21
| Dubai Marina (DLD area: Marsa Dubai)       |  14, muted
| Median price      AED 1,669 per sq ft      |  label and value pairs
| Registered sales  11, from 5 Jan 2026 to   |
|                   10 Nov 2026              |
| See all buildings Fairsquare covers        |  link to /coverage
| Sales data runs to 10 Nov 2026.            |  14, muted
|                                            |
| How it works                               |  h2 24
| (1) Add a screenshot of a listing.         |
| (2) Confirm the building.                  |
| (3) Get a stamped comparison to share.     |
| How Fairsquare compares                    |  link
+--------------------------------------------+
| footer                                     |
+--------------------------------------------+
```

**Desktop 1280:** two columns. Cols 1 to 6: h1 48, lead 18, the scope line, the stale note when it applies, the drop area (176px, 2px dashed `--input`, r8: "[ImageUp Choose a screenshot] or drop it here, or paste with [Ctrl] [V]"), [Paste listing text] [Type the details], the privacy line and How it works. Cols 7 to 12: the "From the data" panel, top-aligned with the h1. No device frame and no example.

Behaviour:

- **Choose a screenshot** is a real `<Button>` that opens a visually hidden, focusable `<input type="file" accept="image/*" className="sr-only">`. Choosing a file starts reading at once and moves to step 2. There is no separate "Read" button.
- **Drag and drop and paste** are extras. Show "or drop it here, or paste with Ctrl V" (Cmd V on Mac) only when `(pointer: fine)` matches. Paste works anywhere on the home page. Count `dragenter` and `dragleave` so the highlight does not flicker. While dragging, the drop area border becomes 2px solid `--primary` with an `--accent` fill.
- **Paste listing text** expands a `Collapsible` with a labelled `Textarea` ("Listing text") and a "Read text" button. Placeholder: "Building name, 2BR, 1284 sqft, AED 2.45M" (a format, never a listing that could pass for a real one).
- **Type the details** goes straight to step 2 with empty fields and no errors shown.
- **From the data** (REAL_DATA.md section 10) is computed on the server from the loaded sales and cached for an hour: the building with the most ready 2-bed sales in the comparison window, its area with the DLD area name, its median AED per sq ft, the number of sales and their date range, and a link to /coverage. Below it: "Sales data runs to {date}." It never shows a listing or an asking price. Before any data is loaded it shows "Sales data is being loaded. Try again in a few minutes." It streams in a Suspense boundary, so the tool never waits for it.
- There are no sample listings and no example card (REAL_DATA.md sections 8 and 10).
- When arriving with `?ref=CODE`, keep the ref in the flow state (and `sessionStorage`, so a reload keeps it) and send it with the comparison (`POST /api/checks`, field `ref`). The server records it on the comparison and, on first touch, on the anonymous id. Nothing visible changes.
- If screenshot reading is off (section 5.6), the primary button becomes "Type the details" and a notice explains why.

### 3.2 Reading state (step 2, while Claude reads)

Route `/?step=details` (pushed with `history.pushState`, so Back returns to step 1).

**Mobile 390:**

```
+--------------------------------------------+
| header 56                                  |
+--------------------------------------------+
| [< Back]                      Step 2 of 3  |
| Check the details                          |  h2, focused on arrival
|                                            |
| +----------------------------------------+ |  border-beam while reading (motion-safe)
| | +------+  Your screenshot              | |
| | | thumb|  [Spinner] Reading the price   | |  role=status, aria-live polite
| | | 64x  |  and size...                  | |
| | | 112  |                               | |
| | +------+  [Stop]                       | |  outline sm, min-h 44
| +----------------------------------------+ |
|                                            |
| Building                                   |  region aria-busy=true
| [======================================]   |  Skeleton h-11
| Area                                       |
| [=======================]                  |
| Bedrooms              Size (sq ft)         |
| [============]        [============]       |
| Asking price (AED)                         |
| [==========================]               |
|                                            |
| Type the details instead                   |  link-style button
+--------------------------------------------+
| [        Compare price  (disabled)       ] |  action bar, aria-disabled while reading
+--------------------------------------------+
```

**Desktop 1280:** left column as above (stepper, thumbnail row with status, skeleton fields). The right column shows the user's own screenshot as a sheet (r16, `shadow-sheet`, max height `100dvh - 140px`) with no stamp yet. The sheet stays there through step 2 so the user can check the numbers against it.

Behaviour:

- Status text follows real phases: "Preparing your screenshot" (client downscale to 1568px on the long edge, as JPEG), then "Reading the price and size" (request in flight; the server reads and matches the building in the same request). After 8 seconds add "Still reading. This can take up to 20 seconds." "Matching the building" (`read.matching`) is used only in step 2, as the polite status while a debounced building match runs after the person edits the name.
- Stop aborts the request (`AbortController` wired to the route handler) and returns to step 1 with the screenshot kept.
- The skeleton has the same dimensions as the fields (no layout shift). The region has `aria-busy="true"` until the fields fill.
- The thumbnail shows "Remove" and "Replace" after reading. Tapping the thumbnail opens a `Dialog` with the full screenshot (pinch zoom allowed, close button 44px).
- The original image stays in memory for the card. Only the downscaled copy goes to the server, and nothing is stored.

### 3.3 Confirm details and pick the building (step 2)

**Mobile 390:**

```
+--------------------------------------------+
| [< Back]                      Step 2 of 3  |
| Check the details                          |
| [thumb]  From your screenshot   [Expand]   |  source line, 14
|                                            |
| Building                                   |
| [Test Tower A                           ]  |  Input h-11, text-base
| From your screenshot                       |  FieldDescription 14
|                                            |
| Area                                       |
| [Dubai Marina                           ]  |
|                                            |
| Bedrooms               Size (sq ft)        |
| [2 bed          v]     [1,284          ]   |  Select / InputGroup suffix "sq ft"
| Not in the screenshot.                     |  shown only when Claude returned null
| Choose one.                                |
|                                            |
| Asking price (AED)                         |
| [AED | 2,450,000                        ]  |  InputGroup prefix, inputMode numeric
|                                            |
| Which building is it?                      |  fieldset legend, 18 weight 600
| +----------------------------------------+ |
| | (o) Test Tower A    (Best match) | |  RadioGroup option card, min-h 56
| |     Dubai Marina                       | |  selected: 2px --primary border, --accent fill
| |     11 two-bed sales in 12 months      | |
| +----------------------------------------+ |
| +----------------------------------------+ |
| | ( ) Test Tower A 2               | |
| |     Dubai Marina                       | |
| |     4 two-bed sales in 12 months       | |
| +----------------------------------------+ |
| (!) Two towers have similar names. Check   |  14, TriangleAlert, only for look-alikes
|     the tower number on the listing.       |
| +----------------------------------------+ |
| | ( ) None of these                      | |
| |     You can ask Fairsquare to add it   | |
| |     next                               | |
| +----------------------------------------+ |
| [Search covered buildings]                 |  outline, opens CommandDialog
|                                            |
+--------------------------------------------+
| [            Compare price               ] |  sticky action bar, primary 48px
+--------------------------------------------+
```

**Desktop 1280:** the stepper above the left column, then the same form in one column (max-w 480px; Bedrooms and Size side by side, as on mobile). Building options sit under the form. "Compare price" is inline under the options (not sticky). The right column keeps the user's screenshot sheet visible for cross-checking.

Behaviour:

- **Two taps.** When every field is filled and the top match scores 0.8 or above, the option is pre-selected. The user's one confirming tap is "Compare price". When a field is missing, only that field shows "Not in the screenshot" help.
$1
- **Off-plan.** Under the price, a checkbox "Off-plan (not finished yet)" with the help line "Off-plan listings are compared with off-plan sales only, all others with ready ones." It is ticked when the read found an off-plan listing, the person can change it, and it is kept with the other values on Back. It decides the completion basis (REAL_DATA.md section 7).
- **Validation.** One Zod schema, `ListingFieldsSchema` in `src/lib/validation/fields.ts` (ARCHITECTURE section 4.6), shared by the form and the `POST /api/checks` route (which returns 422 instead of computing):
  - `bedrooms: z.number().int().min(0).max(7)` (0 is studio, 7 is "7 or more"; never nullable)
  - `sizeSqft: z.number().gt(150)`, `priceAed: z.number().gt(50000)`
  - a refine on price per sq ft between 300 and 6000
  - `buildingText: z.string().trim().min(2)`. The building choice is `buildingId: number | null` in the request (a positive integer, or `null` for "None of these"); the form errors with `err.pick` when nothing is selected.
  - Number inputs go through `toNumberOrUndefined` (never `z.coerce`, which turns "" into 0 = Studio).
  - Unit tests for `null`, `undefined`, `""` and `NaN` on every field.
- react-hook-form with `zodResolver`, `mode: "onTouched"`, `reValidateMode: "onChange"`. Errors show after blur or submit, never before typing. "Compare price" is never disabled.
- On submit with one error, focus that field. With two or more, show an `Alert role="alert"` summary at the top of the form ("Fix 2 things to compare the price") with links that focus each field, and keep the inline `FieldError`s.
- The price-per-sq-ft message is attached to both Size and Price with `aria-describedby`.
- **Building options.** `FieldSet` with `FieldLegend` "Which building is it?" and a `RadioGroup`. Each option is a card at least 56px tall with `has-[:focus-visible]:ring-2 ring-ring`. Show name, area and a coverage line for the bedroom count: "11 two-bed sales in 12 months", or "Only 1 two-bed sale so far: too few to compare". Never show a score. Show at most 3 matches (match floor 0.62), then "None of these". The top option gets a "Best match" badge only when its score is 0.8 or above.
- After the 250ms debounce on typing the building, announce "3 matching buildings" in the polite region.
- **Search covered buildings** opens a `CommandDialog` listing every covered building (name and area). Choosing one selects it as an option.
- **Rental, villa, off-plan.** The extraction schema returns `listing_type`, `property_type` (apartment, villa, townhouse, other) and `completion` (ready, off_plan, unknown). A rental or non-apartment shows an Alert with recovery actions (section 5.3) instead of ending the flow. Off-plan continues with a pinned notice above the result.
- Back returns to step 1 and keeps the screenshot. Browser Back from step 3 returns here with every value kept.

### 3.4 Result (step 3)

Route `/?step=result&code=K7Q2MX`. The code is created on the server when the comparison is stored (numbers only, no image). Reloading without the screenshot in memory redirects to `/c/K7Q2MX`.

**Mobile 390, verdict result:**

```
+--------------------------------------------+
| header 56                                  |
+--------------------------------------------+
| [< Edit details]              Step 3 of 3  |
| Compared with 11 registered sales                |  h2 24, focus target
| [ArrowUp Above recent sales]               |  Badge outline, text --verdict-above
|                                            |
| This listing asks AED 1,908 per sq ft,     |  lead 18
| 14.0% above the median of 11 registered 2-bed    |
| sales in Test Tower A (AED 1,674     |
| per sq ft).                                |
|                                            |
| +----------------------------------------+ |
| | [user's screenshot, cropped 4:5]       | |  stamped sheet, r16, shadow-sheet
| |                                        | |
| |         +-------------------------+    | |
| |         | FAIRSQUARE [s] COMPARED |    | |  the stamp lands here
| |         |         +14.0%          |    | |
| |         |-------------------------|    | |
| |         | VS MEDIAN OF 11         |    | |
| |         | REGISTERED SALES        |    | |
| |         +-------------------------+    | |
| |                            [Expand]    | |  icon button 44, "See the whole card"
| +----------------------------------------+ |
| (!) This screenshot shows the agent's      |  only if contact_details_visible
|     phone number. [Hide contact details]   |
|                                            |
| Source: DLD sales, Data.Dubai. 18 Nov 2025 |  14 muted
| to 17 Nov 2026, same building, 2-bed, per  |
| sq ft.                                     |
| Floor, view, condition and off-plan status |
| aren't included. This is not a valuation.  |
| [CircleHelp How Fairsquare compares]       |  Popover trigger, ghost, min-h 44
|                                            |
| ------------------------------------------ |
| [Calculator] About AED 10,618 a month      |  full-width row button, 56px
| with 20% down                    [Adjust]  |  opens Drawer
| ------------------------------------------ |
| The 11 sales behind this             [v]   |  Accordion, closed on phones
| ------------------------------------------ |
| Compare another listing                    |  link, back to step 1 with empty state
+--------------------------------------------+
| [Share2 Share card]  [Bk Save and track]   |  sticky action bar: primary + outline
+--------------------------------------------+
```

**Desktop 1280:**

```
+------------------------------------------------+-----------------------------------------------+
| (1)---(2)---(3) See the comparison             |                                               |
| [< Edit details]  Test Tower A, 2-bed,   |   +---------------------------------------+   |
| 1,284 sq ft, AED 2,450,000                     |   |                                       |   |
|                                                |   |   user's screenshot, full height,     |   |
| Compared with 11 registered sales          (h2)      |   |   max-h 100dvh - 140, sticky top 88   |   |
| [ArrowUp Above recent sales]                   |   |                                       |   |
| This listing asks AED 1,908 per sq ft, 14.0%   |   |         +---------------------+       |   |
| above the median of 11 registered 2-bed sales in     |   |         |  STAMP              |       |   |
| Test Tower A (AED 1,674 per sq ft).      |   |         +---------------------+       |   |
| Source line. Caveat. How Fairsquare compares   |   |                                       |   |
| [Share card] [Save and track]                  |   +---------------------------------------+   |
| ---------------------------------------------- |   [Hide contact details] [See the whole card] |
| About AED 10,618 a month with 20% down [Adjust]|                                               |
| ---------------------------------------------- |                                               |
| The 11 sales behind this (open)                |                                               |
|   strip chart                                  |                                               |
|   table                                        |                                               |
| ---------------------------------------------- |                                               |
| Compare another listing                        |                                               |
+------------------------------------------------+-----------------------------------------------+
```

On desktop the actions are inline (no sticky bar), the sales accordion is open, and Adjust opens a right-side `Sheet` (440px) instead of a Drawer.

**Order of information (all sizes):** heading and band badge; the one sentence; the stamped sheet; provenance and caveat; actions; monthly cost row; the sales; compare another. One primary action per screen: Share card.

**The stamped sheet.** The user's screenshot in an `<img>` (blob URL, width and height set, `aspect-ratio` reserved) with the `<Stamp>` SVG overlaid at the card position (section 8). The SVG keeps the stamp sharp at any size. On phones the sheet crops to 4:5 from the top, which always contains the stamp (placed at 30% of the height). "See the whole card" opens a full-screen `Dialog` with the full stamped card. The sheet is a `<figure>`. The image's alt text is "Your listing screenshot with the Fairsquare stamp: +14.0% vs median of 11 registered sales". The stamp SVG itself is `aria-hidden`.

If the area under the stamp is dark (mean luminance under 0.45, for example a dark-mode portal screenshot), the stamp sits on a paper label (section 8.3) so it stays legible.

**Band badge.** shadcn `Badge variant="outline"`, 14px weight 600, icon plus text in the verdict colour, `rounded-full`, min height 28px. It is not a button.

**How Fairsquare compares** opens a `Popover` (max-w 340px): "Fairsquare takes the median price per sq ft of same-bedroom sales in this building over the last 12 months. Within 5% either way counts as in line. With fewer than 5 sales it doesn't compare." plus a link "Read how Fairsquare compares".

**The sales behind this.** `Accordion` item with:

1. A dot strip chart (HTML and CSS, not a fixed-viewBox SVG, so text stays at real size):
   ```
   Median AED 1,674                 (label above the median line)
   :         |<-- in line, 5% -->|
   :    o oo o|o  o o  oo     o  |          <>    o = sale (12px, --chart-1)
   +----+-----+------+-----+-----+-----------+--  <> = this listing (16px diamond, --chart-2)
   1,550      1,650        1,750       1,900
                                     This listing AED 1,908  (label below)
   AED per sq ft
   ```
   - One row on an AED per sq ft axis. Where sales overlap within 12px they stack upward like a tally, so height means "more sales here".
   - The in-line band (median plus or minus 5%) is shaded with `--chart-4`, labelled "In line (within 5%)".
   - The median is a 2px dashed `--chart-3` line. Labels sit directly on the chart (median above, this listing below), so they never collide.
   - At most 4 ticks below 640px and 6 above, 14px, tabular.
   - The chart is not interactive. Exact values are in the list below it.
   - The container has `role="img"` and `aria-labelledby` pointing to a visible caption: "11 sales from AED 1,593 to AED 1,763 per sq ft. Median AED 1,674. This listing AED 1,908."
2. The sales. Below 640px a stacked list, from 640px a shadcn `Table`:
   - List row: "12 Mar 2026" (14, muted), "AED 1,696 per sq ft" (16, weight 600), "1,262 sq ft, AED 2,140,000" (14).
   - Table columns: Registered on, Size (sq ft), Price (AED), AED per sq ft. Right-aligned numbers, tabular. Newest first.
   - The last row is "This listing", marked by a 3px `--stamp` left bar and the text "This listing", never by colour alone.
   - Caption: "Registered sales".
   - A sale registered after the user saved shows a "New" badge (sentence case).

**Too few sales (thin) variant.**

```
| Too few sales to compare yet         (h2) |
| [Equal Not enough sales]  (neutral badge) |
| Only 2 registered sales of ready 3-bed    |
| Heights 2 in the last 12 months.          |
| Fairsquare needs at least 5 to compare.   |
| [o][o][ ][ ][ ]  2 of the 5 sales needed  |  MIN_SALES segments, Progress semantics with text
| stamped sheet: stamp shows "2 OF 5"       |
| the 2 sales listed                        |
| monthly cost row                          |
| action bar: [Save and track] (primary)    |
|             [Share card] (outline)        |
```

Helper under Save: "New sales in this building show up under Saved. Fairsquare doesn't send messages yet."

**Not covered variant.** No stamp and no card (there is nothing to compare).

```
| We don't cover Nowhere Test Tower yet (h2)|
| [Building2 Not covered yet] (neutral)      |
| Fairsquare covers 1,240 buildings.         |
| Request this one and track it under Saved. |
| [Search covered buildings]                 |
| monthly cost row (works from price only)   |
| action bar: [Request it and track]         |
```

"Request it and track" sends `POST /api/requests` with the comparison code (choosing "None of these" alone does not file a request). After the request: inline success Alert "Requested. It shows under Saved. 4 other people asked for it too." (`othersAsked` from the response; with 0, drop the second sentence). The button then reads "Requested" and is inert. "Fairsquare covers {n} buildings" takes `n` from `GET /api/buildings` (while no data is loaded, the loading line replaces it).

**Real data (REAL_DATA.md sections 6 to 9).** The provenance starts with "Building: Test Tower A, Dubai Marina (DLD area: Marsa Dubai).", then the attribution with the dataset and licence names linked, the real window dates and the basis ("ready 2-bed apartments"), and "1 unusual sale left out" when outliers were dropped. **Off-plan:** a listing marked off-plan is compared with off-plan sales only, and the notice "Compared with off-plan sales only. Payment plans can explain a different price." sits at the top. **Size:** with a verdict, a note under the sentence says when the listing is more than 20% larger or smaller than the median size of the sales. **Stale data:** when the data ends more than 45 days before today, the stale note sits at the top of every result (section 5.4). **Adviser:** the adviser section of the cost Drawer appears only when `PARTNER_NAME`, `PARTNER_REGULATOR` and `PARTNER_LICENCE` are all set; otherwise the Drawer ends with "Talking to a mortgage adviser through Fairsquare isn't available yet." The list of sales is always free to open, never behind the adviser form or any other ask.

**Off-plan variant.** A pinned notice Alert above the heading: "Off-plan price compared with ready resales. Payment plans can explain a different price." The stamp's last line adds "OFF-PLAN".

**Monthly cost (Drawer on phones, right Sheet on desktop):**

```
+--------------------------------------------+
|                 ------                     |  drawer handle
| Monthly cost estimate                 [X]  |  title 21
| For an asking price of AED 2,450,000       |
|                                            |
| About AED 10,618 a month                   |  <output aria-live=polite>, 30, wdth 88
| Loan                        AED 1,960,000  |  dl rows, 16
| Cash upfront, about           AED 644,350  |
| [v] Show the upfront costs                 |  Accordion
|     Down payment              AED 490,000  |
|     DLD transfer fee (4%)      AED 98,000  |
|     Mortgage registration (0.25%) AED 4,900|
|     Agency fee (2% plus VAT)   AED 51,450  |
|                                            |
| Down payment          20% (AED 490,000)    |
| [-]  o===================------------ [+]  |  Slider + step buttons, 44px
| Interest rate (%)                          |
| [ 4.25                                ]    |  inputMode decimal
| Assumed rate. Check with your bank.        |
| Term                                       |
| [ 25 years                         v  ]    |
|                                            |
| Estimate only, not an offer of credit.     |  14
| Expats usually need at least 20% down on   |
| a first home up to AED 5M, and 30% above.  |
| ------------------------------------------ |
| Talk to a mortgage adviser            (h3) |
| +----------------------------------------+ |
| | {PARTNER_NAME}                         | |  partner card, border --input, r8
| | Licensed by {regulator}, licence {no}. | |
| | They contact you by phone or WhatsApp  | |
| | within 1 business day. Free, no        | |
| | obligation.                            | |
| +----------------------------------------+ |
| [ ] Share my name, phone number and this   |  Checkbox size-5; whole row is the label, py-3
|     listing with {PARTNER_NAME}, a         |
|     licensed mortgage broker, so an        |
|     adviser can contact me about           |
|     financing. I can withdraw this at any  |
|     time.                                  |
|                                            |
|  (after the tick)                          |
| Your name                                  |
| [                                     ]    |  autoComplete=name
| UAE mobile                                 |
| [+971 |                               ]    |  type=tel, inputMode tel, autoComplete tel
| For example +971 50 123 4567               |
| [Send my details to {PARTNER_NAME}] |  primary, loading "Sending..."
| Nothing is shared unless you tick the box  |
| and press send.                            |
+--------------------------------------------+
```

- The down payment minimum follows the price: 20% up to AED 5M, 30% above. The Slider runs from that minimum to 50% in steps of 5, with `aria-valuetext="20 percent, AED 490,000"` and minus and plus buttons for people who cannot drag.
- Rate: Zod 1 to 12, inline `FieldError`. Default 4.25. Term: 15, 20 or 25 years, default 25.
- The output is debounced 400ms and announces only "Monthly payment about AED 10,618". The figure does not animate.
- The cost row on the result page updates when the Drawer closes.
- The consent text is set at 16px. The name and mobile fields appear only after the tick, so there is never a disabled Send button.
- The phone is normalised to E.164 on the server (`0501234567` becomes `+971501234567`). The server stores the consent version, a SHA-256 of the exact consent text, the timestamp, the anonymous id and the comparison code.
- Success replaces the form with a success Alert (focus moves to its heading):

  ```
  [CircleCheck] Sent to {PARTNER_NAME}
  Name: Sara
  Mobile ending 4567
  Listing: Test Tower A, 2-bed, AED 2,450,000
  Sent 17 Nov 2026 at 14:05
  [Withdraw this request]
  ```
  No JSON. Withdraw opens an `AlertDialog` (section 6.9). The record is kept with status "withdrawn", and the partner is told.

**Share card (the growth loop).**

- When the result renders, the card PNG is built in idle time (`requestIdleCallback`, section 8) and kept as a `File`. "Share card" shows a loading state until it is ready (usually under 300ms), because iOS needs `navigator.share` to run inside the tap.
- Tap "Share card": if `navigator.canShare({ files: [card] })`, call `navigator.share({ files: [card], text, url })` directly. One tap, the native sheet.
- Otherwise open a `Drawer` (phones) or `Dialog` (desktop) titled "Share this comparison" with: "Send on WhatsApp" (`https://wa.me/?text=` with the encoded share text and URL), "Download card", and a read-only `Input` holding the /c link with a "Copy link" button. Confirm with `toast.success("Link copied")` and keep the visible link as the lasting fallback.
- **Hide contact details.** When extraction returns `contact_details_visible: true`, a notice under the sheet offers "Hide contact details". It opens a `Dialog` with a card preview and a "Trim the bottom" `Slider` (100% to 40% of the screenshot height, with minus and plus buttons). The trimmed version becomes the shared card. Fairsquare never crops automatically.

**Save and track.**

- Tap: the button becomes "Tracking" with `BookmarkCheck`, and the polite region announces "Saved. New sales in Test Tower A will show under Saved." The header count does not change until a new sale exists.
- Once saved, "Tracking" is a link to `/saved` (same size and style), so tapping it again never removes anything. Removal lives on the Saved page only. There is no toast undo on the result page.

### 3.5 Share page `/c/[code]` and its OG image

Server-rendered. No screenshot exists here, so the stamp sits on a listing plate rebuilt from the stored numbers.

**Mobile 390:**

```
+--------------------------------------------+
| header 56                                  |
+--------------------------------------------+
| Compared on 3 Nov 2026                     |  14 muted
| Test Tower A, 2-bed                  |  h1 30
|                                            |
| +----------------------------------------+ |
| | Listing details                        | |  listing plate, paper #F6F7F4, r16
| | AED 2,450,000                          | |  30, wdth 112
| | 2-bed, 1,284 sq ft                     | |
| | Test Tower A, Dubai Marina       | |
| |          +-------------------------+   | |
| |          | FAIRSQUARE [s] COMPARED |   | |  stamp lands once on first view
| |          |         +14.0%          |   | |
| |          +-------------------------+   | |
| +----------------------------------------+ |
| [ArrowUp Above recent sales]               |
| This listing asked AED 1,908 per sq ft,    |  18
| 14.0% above the median of 11 registered 2-bed    |
| sales (AED 1,674 per sq ft).               |
| Today: +12.1% vs 12 sales.                 |  only if the result has changed
| Source line. Not a valuation.              |  14
| [v] See the 11 sales behind this           |  Accordion, same chart and list
|                                            |
+--------------------------------------------+
| [   Compare a listing you're looking at  ] |  sticky action bar, links to /?ref=K7Q2MX
+--------------------------------------------+
```

**Desktop 1280:** two columns. Left (cols 1 to 6): date, h1, badge, sentence, today line, source, caveat, the accordion open, and the CTA inline. Right (cols 7 to 12): the listing plate with the stamp, sticky. No device frame.

- The page recomputes on every request. When the median or count has changed, it adds "Today: +12.1% vs 12 sales." so old links stay honest.
- `generateMetadata`: title "+14.0% vs 11 registered sales: Test Tower A 2-bed", description "Fairsquare compared this asking price with 11 registered sales of ready 2-bed apartments from the 12 months to 17 Nov 2026. Not a valuation.". Build every URL from `APP_URL`, read on the server (the browser gets it from `PublicConfig.appUrl`; there are no `NEXT_PUBLIC_*` variables).
- Count each view as a `card_viewed` event, with the viewer's anonymous id when they already have one (the page never creates an id), for the admin share funnel.
- Unknown code: section 3.11.
- A not-covered comparison (reachable from Saved or a typed link) shows the listing plate with no stamp, the `[Building2 Not covered yet]` badge, `none.h2` as the heading, and the same CTA. Its OG image shows the plate and building name without a stamp.

The OG image (1200 by 630) is specified in section 8.4.

### 3.6 Saved

Route `/saved`. Mobile and desktop share one centred column (max-w 720px).

```
+--------------------------------------------+
| Saved                                 (h1) |
| Saved on this browser. New sales in these  |  16 muted
| buildings show here. Fairsquare doesn't    |
| send messages yet.                         |
|                                            |
| Listings                              (h2) |
| ------------------------------------------ |
| Test Tower A           (1 new sale)  |  Item: title 21 + Badge
| 2-bed, AED 2,450,000                       |
| Saved 12 Nov: +14.0% vs 11 sales.          |  14
| Today: +12.1% vs 12 sales.                 |
| [Open]                             [...]   |  Open -> /c/code; overflow: Remove
| ------------------------------------------ |
| Removed Test Tower B. [Undo]      |  inline undo row, 10 s, focus stays here
| ------------------------------------------ |
| Buildings you asked for               (h2) |
| Nowhere Test Tower                        |
| Requested 12 Nov. 4 other people asked.    |
| (Not covered yet)                          |
| ------------------------------------------ |
| Adviser request                       (h2) |
| Sent to {PARTNER_NAME} on 12 Nov.   |
| [Withdraw]                                 |
| ------------------------------------------ |
| Your data                             (h2) |
| Your list lives on this browser. To keep   |
| it on another browser, copy your recovery  |
| link.                                      |
| [Link Copy recovery link]                  |
|                                            |
| [Trash2 Delete all my data]                |  destructive outline, 24px above, alone
+--------------------------------------------+
```

- A listing reopens at its original code (`/c/K7Q2MX`) with today's numbers. Reopening never creates a new code. "Open" first calls `POST /api/saved/{code}/seen`, then navigates.
- Remove: the item collapses into an inline row "Removed {building}. Undo" for 10 seconds, with focus moved to the Undo button. This is in place of a toast-only undo, so keyboard and screen-reader users can reach it. Remove is a soft delete on the server, and Undo saves the same code again, which restores the original "Saved {date}" baseline exactly. When the row times out, focus moves to the next item (or the Listings h2).
- The header Saved badge counts listings with sales recorded since the person last opened them (`unseenNewSales`). It clears for a listing when the user opens it. The item's own "1 new sale" badge counts sales since saving and does not clear.
- "Buildings you asked for" lists `MeView.requests` (requests from the not-covered result and from the Coverage form), one row per building, with "Now covered. Compare again." once an admin has marked it covered. The section is hidden when there are none.
- "Adviser request" lists `MeView.leads`, newest first, with Withdraw on active ones.
- The page reads `GET /api/saved` and `GET /api/me`. Neither creates an anonymous id, so a first-time visitor sees the empty state without getting a cookie.
- Copy recovery link: copies a signed link that restores the anonymous id on another browser (for people moving from WhatsApp's in-app browser to Safari or Chrome). Toast: "Recovery link copied. Anyone with this link can see your saved list."
- Delete all my data: `AlertDialog` (section 6.9). After deletion, focus moves to the h1 and the page shows the empty state.
- Empty state (shadcn `Empty`): "Nothing saved yet", "Save a comparison to see new sales in that building here.", [Compare a listing].

### 3.7 Coverage and building requests

> Real scale (REAL_DATA.md sections 6 and 11): thousands of buildings, so the list is searched on the server (name or area, 2+ letters, after a 150 ms pause, results announced) and paged by 50 with real `?q=&page=` links, most sales in the window first. Columns: Building, Area (with the DLD area name), Ready sales, Off-plan sales, Latest sale, Apartment types ("2-bed: 11 sales" with neutral badges). The wireframe below predates this and shows the idea only.

Route `/coverage`.

**Mobile 390:**

```
+--------------------------------------------+
| Buildings Fairsquare covers           (h1) |
| Fairsquare compares a listing when the     |
| building has at least 5 registered sales   |
| of that apartment type in the 12 months of |
| data.                                      |
| [Search buildings              ] 2+ letters |
|                                            |
| Search buildings                           |  label
| [Search  Marina                         ]  |  Input with Search icon
| ------------------------------------------ |
| Test Tower A                         |  title 21
| Dubai Marina. Latest sale 8 Oct 2026.      |  14
| 2-bed: 11 ready, 0 off-plan (Enough ready sales)|
| ------------------------------------------ |
| Test Tower A 2                       |
| Dubai Marina. Latest sale 26 Oct 2026.     |
| 2-bed: 0 ready, 7 off-plan (Enough off-plan sales)|
| ------------------------------------------ |
| Test Tower C 2                        |
| Al Jaddaf. Latest sale 30 Jul 2026.        |
| 3-bed: 2 ready, 0 off-plan (Too few sales) |  outline badge
| ------------------------------------------ |
| Don't see your building?              (h2) |
| Building name and area                     |  FieldLabel (visible)
| [                                       ]  |
| [Request this building]                    |  submit, enterKeyHint send
+--------------------------------------------+
```

**Desktop 1280:** a centred column (max-w 960px) with a `Table`: Building, Area, Apartment types (one line per bedroom count, "2-bed: 11 sales"), Latest sale, Status. The request form sits to the right of the intro at 1024px and up.

- Search filters as the user types (debounced 150ms) and announces "2 buildings match".
- No match: "No covered building matches "Harbour"." with [Request "Harbour"].
- Request success: `toast.success("Requested. It shows under Saved.")` and the input clears. Error under the field: "Type a building name."

### 3.8 Admin

All admin routes sit under `/admin`, behind `ADMIN_PASSWORD` with an HMAC-signed session cookie. Admin is desktop-first and works in one column on phones (tables become stacked rows, section tabs become a `Select`).

**Login (`/admin/login`):**

```
+---------------------------------------------+
|           [mark] Fairsquare admin           |
|  +---------------------------------------+  |
|  | Sign in                          (h1) |  |  Card, max-w 400, centred
|  | Password                              |  |
|  | [****************          ] [Eye]    |  |  autoComplete current-password, paste allowed
|  | [            Sign in             ]    |  |
|  +---------------------------------------+  |
+---------------------------------------------+
```

Errors: "That password is wrong." After 5 failures in 15 minutes: "Too many tries. Wait 15 minutes."

**Admin shell:** header "Fairsquare admin" with tabs Overview (`/admin`), Leads (`/admin/leads`), Requests (`/admin/requests`), Sales data (`/admin/sales`), Quality (`/admin/quality`), and "Sign out" on the right, separated by 24px. The tabs are links with `aria-current="page"`. Admin data comes from `/api/admin/*` (ARCHITECTURE section 4.4).

**Overview (`/admin`):**

```
+------------------------------------------------------------------------------------------------+
| Overview                                              [7 days | 30 days | 90 days]  ToggleGroup |
|                                                                                                |
| Comparisons     Reads        Read failures   Shares created  Share page views                   |
| 412             388          21              97              640             (30, number-ticker)|
| Comparisons from shares  Cost estimates opened  Adviser requests  Withdrawn                    |
| 74                       156                    9                 1                            |
| ---------------------------------------------------------------------------------------------- |
| Funnel                                       | Verdicts                                         |
| New visitors  ========================  2,310 | Above          ===========  41%                 |
| Reads         =========              388     | In line        ========     30%                 |
| Comparisons   ==========             412     | Below          ====         15%                 |
| Shares        ==                      97     | Too few sales  ===          10%                 |
| Share views   ======                 640     | Not covered    =             4%                 |
| From shares   ==                      74     | (bars labelled directly; arrow icons on labels)  |
| Leads         .                        9     |                                                  |
| K-factor: 0.18 comparisons per comparison    |                                                  |
| ---------------------------------------------------------------------------------------------- |
| Comparisons per day (shadcn Chart line, --chart-1; read failures --chart-5)                    |
+------------------------------------------------------------------------------------------------+
```

KPIs are a definition-list grid separated by hairlines, not boxed cards. Each value uses number-ticker once on load (final value under reduced motion). Charts come with a "Show as table" toggle. Definitions (ARCHITECTURE `AdminStats`): "New visitors" are anonymous ids first created in the range (an id is created on the first read, comparison, save or request, never by a page view); "Shares created" counts share, WhatsApp, copy-link and download events; "Share page views" counts `/c` views; "Comparisons from shares" counts comparisons that arrived with `?ref`; K-factor is comparisons from shares divided by comparisons.

**Leads (`/admin/leads`):** a data table (shadcn Table with TanStack, sortable with `aria-sort`).

| Received | Name | Mobile | Listing | Consent | Status | Actions |
|---|---|---|---|---|---|---|
| 17 Nov 2026, 14:05 | Test Person | +971 •• ••• 4567 [Reveal] | Test Tower A, 2-bed, AED 2,450,000 | optin-v1 | New | [Mark sent to partner] |

- Reveal is a button with `aria-label="Reveal mobile for Sara"`. Reveals are logged.
- Status: "New", "Sent to partner on {date}", "Withdrawn on {date}. Tell the partner." (with [Partner told]) or "Withdrawn on {date}. Partner told." Withdrawn rows stay, in muted text plus the word.
- In v1, leads reach the partner through Export CSV; "Mark sent to partner" records that.
- Filters: status and date range. [FileDown Export CSV].

**Requests (`/admin/requests`):** Building as typed, Area, Requests, People, First asked, Last asked, and [Mark as covered] (a Popover with a building combobox that links the request to a building; requesters then see "Now covered" under Saved).

**Sales data (`/admin/sales`):** `Tabs`: Sales, Register a sale, Buildings, Import CSV.

- Sales: table filtered by building and bedrooms, newest first, with a Delete button per row (`AlertDialog`: "Delete this sale?" / "It changes the comparison for everyone looking at this building." / [Delete sale] [Keep sale]).
- Register a sale:

  ```
  Building            [Test Tower A        v]   Popover + Command combobox
  Bedrooms            [2 bed  v]
  Size (sq ft)        [        ]
  Price (AED)         [AED |         ]
  Registered on       [dd/mm/yyyy]                    native date input, not in the future
  Reference           [                    ]          optional, e.g. the DLD transaction number (external_ref)
  Completion  (o) Ready  ( ) Off-plan                  RadioGroup (REAL_DATA.md section 12)
  +------------------------------------------------+
  | The 2-bed median in Test Tower A moves   |  Alert role=status, after valid fields
  | from AED 1,674 to AED 1,682 per sq ft.         |
  | 3 saved listings will show a new sale.         |
  +------------------------------------------------+
  [Register sale]
  ```
  Fields start empty (no pre-filled values). Admin sales are stored with source "admin" (there is no source picker). Success: `toast.success("Sale registered")`.

- Buildings: a table of buildings (name, area with the DLD area name, aliases, sales) with [Add building] (name, area, optional project names, aliases) and, per row, [Add alias]. Adding either takes effect for matching at once. With thousands of DLD buildings the table is searched on the server (name, area, DLD area or other name, 2+ letters) and loads 50 rows at a time ("Show 50 more"); the building pickers list at most 100 matches.
- The sales table has a Completion column (Ready or Off-plan).
- Above the tabs, the "Data source" panel (REAL_DATA.md section 12): dataset title and link, publisher, licence, downloaded date, data range, rows kept and read, buildings, last load time, what the database holds, a short snapshot sha, and the rows left out by reason behind a toggle. It also covers nothing loaded yet, a newer snapshot waiting, and could not be read.
- Import CSV, three steps on one page:
  1. A `Select` for the kind (Sales, Buildings, Aliases), the "Choose CSV file" button and [Download template] (the header row is built in the browser from `CSV_COLUMNS`). Sales columns: `building_name, sale_date (YYYY-MM-DD), bedrooms, size_sqft or size_sqm, price_aed, external_ref (optional), completion (optional: ready or off_plan), area (optional: tells apart buildings with the same name)`. Buildings: `name, area, project, master_project`. An old file's `is_demo` column is ignored. Aliases: `building_name, alias`.
  2. Dry run, no writes: "23 rows ready. 2 rows rejected." A table of rejected rows: Row, Problem ("Unknown building: Harbour Pt", "Size is missing", "Date is in the future", "Price per sq ft looks wrong"). Duplicates of existing sales are skipped and counted, not rejected. Per-building impact summary (median before and after). Buttons [Import 23 sales] and [Choose another file]. A `Progress` bar while uploading files over 1,000 rows.
  3. Done: `toast.success("23 sales imported")` and the impact summary stays on screen.

**Quality (`/admin/quality`):** a table of fields people changed after reading ("Building 12%, Bedrooms 3%, Size 8%, Price 2%", from `editedFieldRate`); read failures by code (refusals `extract_refused`, `max_tokens` stops `extract_unreadable`, invalid images `image_rejected` / `unsupported_image`, rate limits `rate_limited` / `daily_cap_reached`, timeouts `extract_timeout`, from `extractFailByCode`); median read time (`medianReadMs`); data freshness per building and bedroom count (`freshness`). All plain tables, with the same 7 / 30 / 90-day range control as the Overview.

### 3.9 How Fairsquare compares (methodology and about)

> Real data (REAL_DATA.md section 9): the `#data` section shows the linked attribution, the loaded date range (or the loading line), what is included and left out, ready versus off-plan, DIFC not being in DLD data, the size caveat, the refresh cadence and the independence line. There is no example section.

Route `/how-it-works`. One prose column, max 65ch, h2 sections. On desktop a sticky table of contents sits on the left (cols 1 to 3), the text in cols 4 to 10.

```
| How Fairsquare compares               (h1) |
| Fairsquare compares an asking price with   |
| recent sales of the same apartment type in |
| the same building. It is not a valuation.  |
|                                            |
| What Fairsquare compares              (h2) |
| The rules                             (h2) |
|   dl: Same building / Same apartment type /|
|   Last 12 months / At least 5 sales /      |
|   Median price per sq ft / Within 5% is    |
|   in line                                  |
| What it leaves out                    (h2) |
| Where the data comes from             (h2) |
| Who reads your screenshot             (h2) |
| An example                            (h2) |
|   static example sheet + the 11 sales     |
| Not a valuation                       (h2) |
| [Compare a listing]                        |
```

Copy is in section 6.10.

### 3.10 Privacy

Route `/privacy`. Same prose layout. Sections: What Fairsquare stores (table: Data, Why, How long), What Fairsquare doesn't store, Who sees your data, Cookies, Your choices, Contact. Copy is in section 6.11.

### 3.11 Not found, errors and offline

```
+--------------------------------------------+
| header                                     |
|                                            |
| This page doesn't exist              (h1)  |  shadcn Empty, left-aligned
| The link may be mistyped or out of date.   |
| [Compare a listing]                        |
+--------------------------------------------+
```

- `not-found.tsx`: as above.
- `/c/[code]` with an unknown code: "This comparison link doesn't work" / "It may be mistyped, or the comparison was deleted." / [Compare a listing].
- `error.tsx`: "Something went wrong on our side" / "Try again. If it keeps happening, type the details by hand on the home page." / [Try again] [Go to the home page].
- Offline (detected with `navigator.onLine` and failed fetches): an inline Alert on the step in use: "You're offline. Connect and try again." The manual path still validates locally.

---

## 4. Component inventory

### 4.1 shadcn/ui

Install (in the app repo, not here):

```
npx shadcn@latest add button input textarea label field input-group select radio-group checkbox \
  slider accordion collapsible alert alert-dialog badge card dialog drawer sheet popover command \
  table tabs toggle-group skeleton spinner sonner separator dropdown-menu progress empty item kbd \
  chart tooltip
```

`field`, `input-group`, `spinner`, `empty`, `item` and `kbd` arrived in the October 2025 shadcn release. If the CLI cannot find one, build that piece from the older primitives named in the Notes column.

| UI need | shadcn/ui | Notes |
|---|---|---|
| Header links, Saved link, menu trigger | `Button` (variant ghost, link), `Badge` | Min 44 by 44. Saved count has an sr-only phrase. |
| Mobile menu | `Sheet` (side right) | Focus trapped, returns to the trigger. |
| Theme switch | `DropdownMenu` | Light, Dark, System. |
| Primary, secondary, destructive actions | `Button` | cva sizes: default `h-11 md:h-10`, lg `h-12`, sm `h-9 pointer-coarse:min-h-11`, icon `size-11`. Loading state: `Spinner` plus a changed label, `aria-disabled`. |
| Screenshot chooser | `Button` plus sr-only `<input type=file>` | Not a label styled as a drop zone. |
| Paste text | `Collapsible`, `Textarea`, `Field` | Textarea `text-base md:text-sm`, min-h 96. |
| Reading status | `Alert` (`role="status"`), `Spinner` | Failures use `Alert` with `role="alert"` plus action buttons. |
| Field placeholders while reading | `Skeleton` | Matches field sizes; `aria-busy` on the region. |
| Step progress | custom `<StepHeader>` (`<ol>`) | `aria-current="step"`. |
| Detail fields | `Field`, `FieldLabel`, `FieldDescription`, `FieldError`, `FieldGroup`, `Input`, `InputGroup` (AED prefix, sq ft suffix), `Select` (bedrooms) | RHF `Controller` + Field. Inputs `h-11 text-base md:text-sm`. Fallback without Field: `Label` + `aria-describedby`. |
| Error summary | `Alert` (`role="alert"`) with links | Shown on submit with 2 or more errors. |
| Building options | `FieldSet`, `FieldLegend`, `RadioGroup`, `RadioGroupItem` (rendered as cards), `Badge` ("Best match") | Cards min-h 56, focus ring via `has-[:focus-visible]`. |
| Building search | `CommandDialog` (`Command`, `CommandInput`, `CommandList`, `CommandItem`) | Also used as the admin combobox inside `Popover`. |
| Screenshot zoom, full card | `Dialog` | Close button 44px; Esc closes. |
| Band badge | `Badge` (variant outline) | Icon plus text in the verdict colour. |
| How Fairsquare compares | `Popover` | Opens on tap or Enter, not hover. |
| The sales | `Accordion`, `Table`, custom `<SalesStrip>` | Closed on phones, open on desktop. |
| Monthly cost | `Drawer` (below 1024px), `Sheet` side right (1024px and up), `Slider`, `Input`, `Select`, `Accordion`, `Separator` | One responsive `<CostPanel>` wrapper picks Drawer or Sheet. |
| Consent and lead | `Checkbox`, `Label`, `Field`, `Input` (tel), `Button`, `Alert` (success) | Unticked by default. Fields mount after the tick. |
| Confirm destructive actions | `AlertDialog` | Withdraw request, delete all data, admin delete sale. Destructive button on the right, cancel on the left, 8px apart, never adjacent to the primary. |
| Share fallback | `Drawer` / `Dialog`, `Input` (read-only), `Button` | Visible link is the lasting fallback. |
| Hide contact details | `Dialog`, `Slider`, `Button` | Minus and plus buttons as a drag alternative. |
| Toasts | `Sonner` (`toast.success`, `toast.error`) | Transient confirmations only. Never field errors. |
| Saved rows | `Item` (fallback: `<li>` with `Separator`), `Badge`, `DropdownMenu` (overflow) | |
| Empty states | `Empty` | Heading, one sentence, one action. |
| Coverage list | `Input`, `Table` (desktop), `Item` (phone), `Badge` | |
| Admin | `Card` (login only), `InputGroup` with show/hide button, `Tabs`, `ToggleGroup`, `Chart`, `Table` (+TanStack), `Select`, `Popover` + `Command`, `Alert`, `AlertDialog`, `Progress` | |
| Keyboard hint | `Kbd` | "Ctrl V" on fine pointers only. |
| Tooltips | `Tooltip` | Only as a second label on desktop icon buttons that already have an `aria-label`. Never the only way to get information. |

### 4.2 Magic UI (three components)

Verified in `registry.json`. Install with `npx shadcn@latest add @magicui/<name>`.

| Component | Where | Purpose | Reduced-motion fallback |
|---|---|---|---|
| `blur-fade` | Result sheet, first 160ms of the stamp sequence; /c plate on first view | The sheet appearing before the stamp lands. Used once per page. | Renders final state (MotionConfig `reducedMotion="user"`). |
| `border-beam` | Thumbnail card while Claude reads | Shows that work is in progress around the thing being read. Colours `--primary` to `#6BBBCB`, duration 2.4s, size 80. Removed when reading ends. | Static 2px `--primary` border, Spinner static, status text. Wrap in `motion-safe:`. |
| `number-ticker` | Admin Overview KPIs only | Gives a sense of change on load in an internal tool. | Final value immediately. |

**Not used, on purpose:** confetti (would celebrate a price comparison), shimmer-button, rainbow-button, pulsating-button, shiny-button, ripple-button, interactive-hover-button (hype on CTAs), aurora-text, sparkles-text, animated-gradient-text, hyper-text, morphing-text, typing-animation, word-rotate (template headline tricks), meteors, particles, retro-grid, grid-pattern, dot-pattern, flickering-grid, warp-background, light-rays, globe, dotted-map (decoration that competes with the stamp), magic-card, neon-gradient-card, bento-grid (card kit), animated-list (motion without information on Saved), shine-border (decoration), animated-circular-progress-bar ("1 of 3" is clearer as three segments), noise-texture (the stamp texture is a mask, built into `<Stamp>`), android and safari (one frame is enough).

### 4.3 Custom components

| Component | File | Notes |
|---|---|---|
| `<MarketScale>` | `src/components/result/market-scale.tsx` | The result's market scale (RESULT_SPEC section 4): one dot per registered sale, the in-line zone, the median fulcrum and the compact ASKING stamp on its pin, all from `scaleModel()`. Tap, drag or the arrow keys read a sale. Also on /c. |
| `<SalesList>` | `src/components/result/sales-list.tsx` | The sales list (RESULT_SPEC section 5): stacked rows on phones, a table on desktop, newest first or by price per sq ft, same-size marks, Show all. Never gated. |
| `<EditSheet>` | `src/components/result/edit-sheet.tsx` | The Change a detail sheet (RESULT_SPEC section 7): a Drawer on phones, a right Sheet on desktop; one row opens one question. |
| `<MoreShareSheet>` | `src/components/share/more-share.tsx` | "More ways to share" (RESULT_SPEC section 8.2): the card image, Send the card image, Download card, Copy link, Copy text. |
| `renderCard()` | `src/lib/stamp/card-canvas.ts` | Canvas card (section 8.3): a Fairsquare document with the verdict stamp and a mini scale, never the listing screenshot. Client only. |
| `<StepHeader>`, `<ActionBar>` | `src/components/flow/*` | Sticky bar sets `data-action-bar` on `<html>` while mounted. Used by the compare flow and by `/c`. |
| `<LiveRegion>`, `useAnnounce()` | `src/components/a11y/*` | Polite and assertive regions. |
| `<Attribution>` | `src/components/data/attribution.tsx` | The REAL_DATA.md section 9 source line; dataset and licence names link to the manifest's URLs (plain text before any data is loaded). Footer, provenance, How it works. |
| `<StaleNote>`, `<Notice>` | `src/components/data/data-notice.tsx` | The stale-data note and the Info-icon notices (section 5.4). |
| `<FromTheDataPanel>` | `src/components/home/from-the-data.tsx` | The home page's real-data panel (section 3.1). Server-rendered. |
| `<DataSourcePanel>` | `src/components/admin/data-source-panel.tsx` | The admin "Data source" panel (section 3.8). |
| `scrollIntoViewSafe()` | `src/lib/motion.ts` | Reduced-motion aware. |

---

## 5. States

### 5.1 Loading

| Surface | Loading treatment | Text |
|---|---|---|
| Choose a screenshot to read | Immediately go to step 2. Thumbnail with border-beam, status Alert, field Skeletons, `aria-busy`. | Phases: "Preparing your screenshot", "Reading the price and size", "Matching the building". After 8 s: "Still reading. This can take up to 20 seconds." |
| Compare price | Button: Spinner, label "Comparing...", `aria-disabled`. Usually under 300ms, so the spinner appears only after 150ms. | |
| Card render | Share button: Spinner, label "Preparing card...". Sheet already visible (SVG stamp). | |
| Send details | Button: Spinner, label "Sending...". | |
| /c page, Saved, Coverage | Server-rendered; `loading.tsx` shows Skeletons matching the layout (heading line, plate 4:5, three text lines). | |
| Admin tables and charts | Skeleton rows (5) and a Skeleton chart frame; never an empty axis. | |
| CSV dry run | `Progress` with "Checking row 400 of 1,200". | |

### 5.2 Empty

| Where | Heading | Body | Action |
|---|---|---|---|
| Saved, nothing saved | Nothing saved yet | Save a comparison to see new sales in that building here. | Compare a listing |
| Saved, no requests | (section hidden) | | |
| Coverage search, no match | No covered building matches "{q}". | You can ask Fairsquare to add it. | Request "{q}" |
| Building options, nothing typed | (no options) | Type the building name to see matches. | |
| Building options, no match | (only "None of these" shown) | No covered building matches this name. | Search covered buildings |
| Admin leads | No adviser requests yet | They appear here when someone ticks the box and sends their details. | |
| Admin requests | No building requests yet | | |
| Admin sales for a filter | No sales match these filters | | Clear filters |

### 5.3 Errors (every error states the cause and offers a way out)

| Case | Shown as | Text | Actions |
|---|---|---|---|
| Not a listing | Alert role=alert, step 2 | That doesn't look like a property listing. Try a screenshot that shows the price. | Try another screenshot; Type the details |
| Rental | Alert | This looks like a rental listing. Fairsquare compares sale prices only. | It's for sale, continue; Try another screenshot |
| Villa or townhouse | Alert | This looks like a villa or townhouse. Fairsquare compares apartments only for now. | Type the details anyway; Try another screenshot |
| Claude refused (`stop_reason: "refusal"`) | Alert | Claude couldn't read this one. Type the details instead. | Type the details; Try another screenshot |
| Answer cut short (`stop_reason: "max_tokens"`) | Alert | The reading was cut short. Try again, or type the details. | Try again; Type the details |
| Invalid image | Alert | That image couldn't be read. Try a JPEG or PNG screenshot. | Try another screenshot; Type the details |
| Timeout (25 s) | Alert | Reading took too long. Try again, or type the details. | Try again; Type the details |
| Offline | Alert | You're offline. Connect and try again, or type the details. | Try again; Type the details |
| Unknown server error | Alert | Reading failed. Try again, or type the details. | Try again; Type the details |
| Field errors | FieldError under the field, summary on submit | Section 6.4 | |
| Compare request failed | Alert above the action bar | Couldn't compare just now. Try again. | Try again |
| Lead send failed | FieldError-style Alert above Send | Couldn't send your details. Nothing was shared. Try again. | Try again |
| Share failed (not a user cancel) | toast.error | Couldn't open sharing here. Download the card or copy the link instead. | Opens the share fallback |
| Clipboard blocked | inline under the link | Copy didn't work here. Press and hold the link to copy it. | |

### 5.4 Data states (REAL_DATA.md section 7)

There is no demo mode. The data status comes from the server with the public config (`dataFrom`, `dataThrough`, `stale`, the source and licence URLs).

| State | What shows |
|---|---|
| Data loaded and fresh | Results, /c and the home panel name the source and the real dates. "Sales data runs to {date}." under the home panel. |
| Stale: the data ends more than 45 days before today | "Fairsquare's sales data currently runs to {date}. Sales registered after that aren't included yet." with the Info icon, on every result, the home page, /c and Coverage. |
| No data loaded yet | Home: "Sales data is being loaded. Try again in a few minutes." in place of the panel. Comparisons come back not covered, with the same line instead of the building count. |
| Off-plan listing | Compared with off-plan sales only: "Compared with off-plan sales only. Payment plans can explain a different price." on the result. |
| Listing size differs by more than 20% | With a verdict: "This listing is 24% larger than the typical sale here. DLD sizes may be measured differently, for example with or without balconies." |
| Unusual sales left out | "1 unusual sale left out" in the provenance. |
| No adviser partner configured | The cost Drawer ends with "Talking to a mortgage adviser through Fairsquare isn't available yet."; Privacy leaves out the partner rows; `POST /api/leads` answers 404 `leads_unavailable`. |

### 5.5 Rate limits

| Case | Text | Actions |
|---|---|---|
| Our per-browser read limit (signed cookie id), from `Retry-After` | You've read a lot of screenshots in a short time. Wait {n} minutes, or type the details. | Type the details |
| Anthropic rate limit or overloaded (429, 529) | Claude is busy right now. Try again in a minute, or type the details. | Try again (enabled after 30 s, with a visible countdown "Try again in 24 s"); Type the details |
| Compare or request spam limit | Too many requests from this browser. Wait a minute and try again. | |
| Admin login | Too many tries. Wait 15 minutes. | |

### 5.6 Claude unavailable: manual entry fallback

Triggered when `ANTHROPIC_API_KEY` is missing, or three reads in a row fail with server errors or timeouts (the circuit opens for 5 minutes). The page learns this from `PublicConfig.extractEnabled` on load, or from an `extract_unavailable` response.

- Home: a notice Alert above the actions: "Screenshot reading is off right now. Type the details instead. It takes about 20 seconds." The primary button becomes "Type the details". "Choose a screenshot" is hidden. "Paste listing text" stays and uses the local parser (`parseFields`, the same rules as the bot's `textparse.py`: bedrooms, sq ft or sq m, AED with M or K), then opens step 2 with the fields it found.
- Step 2 works as normal from typed values. Building matching runs on the server (`GET /api/buildings/match`) without Claude, so building options still work.
- The result, share, save and cost features all work without Claude.

---

## 6. Copy deck

Voice: plain verbs, sentence case, active voice, no filler, no exclamation marks, no apologies. One verb for the core action: **compare**. Numbers: AED with digit grouping ("AED 2,450,000"), "sq ft" (never "sqft" in our copy), "2-bed" and "studio", one decimal on percentages, the true minus sign (U+2212) and a plus sign on signed figures, no sign in sentences ("14.0% above"), en-GB dates ("17 Nov 2026").

**Never write:** overpriced, underpriced, good deal, bargain, fair price, fairly priced, rip-off, verified, certified, approved, checked (on the stamp), valuation (except "not a valuation"). No middle-dot strings, no "→" in labels, no ALL CAPS outside the stamp.

All strings live in `src/lib/copy.ts`. Placeholders in braces. `{sales}` is "registered sales" (REAL_DATA.md section 9). `{bedType}` is "2-bed" or "studio".

### 6.1 Shell

| Key | String |
|---|---|
| `nav.compare` | Compare |
| `nav.saved` | Saved |
| `nav.savedSr` | Saved, {n} listings have new sales |
| `nav.coverage` | Coverage |
| `nav.how` | How Fairsquare compares |
| `nav.privacy` | Privacy |
| `nav.menu` | Menu |
| `nav.skip` | Skip to content |
| `theme.label` | Theme |
| `theme.options` | Light / Dark / System |
| `footer.notValuation` | Fairsquare compares asking prices with registered sales. It is not a valuation and not financial advice. |
| `footer.ai` | Fairsquare uses Claude, Anthropic's AI, to read screenshots. |

### 6.2 Home and step 1

| Key | String |
|---|---|
| `home.h1` | Weigh the asking price. |
| `home.lead` | Add a screenshot of a Dubai apartment listing. Fairsquare compares its price per sq ft with registered sales in the same building. |
| `home.choose` | Add a screenshot |
| `home.dropActive` | Drop the screenshot to read it |
| `home.paste` | Paste listing text |
| `home.pasteLabel` | Listing text |
| `home.pastePlaceholder` | Building name, 2BR, 1284 sqft, AED 2.45M |
| `home.pasteRead` | Read text |
| `home.type` | Type the details |
| `home.privacy` | Fairsquare uses Claude, Anthropic's AI, to read your screenshot. It isn't stored. |
| `home.privacyLink` | Privacy |
| `home.dataH2` | From the data |
| `home.dataLink` | See all buildings Fairsquare covers |

### 6.3 Reading

| Key | String |
|---|---|
| `step.back` | Back |
| `read.reading` | Reading the listing |
| `read.matching` | Finding the building |
| `read.slow` | Still reading. This usually takes about {s} seconds. |
| `read.slowFallback` | Still reading. This can take up to 20 seconds. |
| `read.stop` | Stop |
| `read.stopped` | Reading stopped. Your screenshot is still here. |
| `read.stoppedText` | Reading stopped. Your text is still here. |
| `read.typeInstead` | Type the details instead |
| `read.thumb` | Your screenshot |
| `read.replace` | Replace |
| `read.remove` | Remove screenshot |
| `read.view` | View screenshot larger |

### 6.4 Details and building

| Key | String |
|---|---|
| `details.h2` | Check the details |
| `details.source.claude` | From your screenshot |
| `details.source.manual` | Added by you |
| `details.source.changed` | Changed by you |
| `details.missing` | Not in the screenshot. Add it here. |
| `details.missingBeds` | Not in the screenshot. Choose one. |
| `field.building` | Building |
| `field.area` | Area |
| `field.bedrooms` | Bedrooms |
| `field.bedroomsOptions` | Studio / 1 bed / 2 bed / 3 bed / 4 bed / 5 bed / 6 bed / 7 or more |
| `field.size` | Size (sq ft) |
| `field.price` | Asking price (AED) |
| `err.bedrooms` | Choose the number of bedrooms. |
| `err.size` | Enter the size in sq ft, for example 1,284. |
| `err.price` | Enter the asking price in AED, for example 2,450,000. |
| `err.psf` | That works out to AED {psf} per sq ft, which looks wrong. Check the size and price. |
| `err.building` | Enter the building name as the listing shows it. |
| `err.pick` | Choose a building, or choose None of these. |
| `err.summary` | Fix {n} things to compare the price |
| `pick.legend` | Which building is it? |
| `pick.best` | Best match |
| `pick.coverage` | {n} {basis} {bedWord} sales in {months} months |
| `pick.coverageThin` | Only {n} {basis} {bedWord} sale in {months} months: Fairsquare needs {minSales} to compare / Only {n} {basis} {bedWord} sales in {months} months: Fairsquare needs {minSales} to compare |
| `pick.coverageZero` | No {basis} {bedWord} sales in {months} months: Fairsquare needs {minSales} to compare |
| `pick.lookalike` | Two towers have similar names. Check the tower number on the listing. |
| `pick.sameName` | Two buildings have this name in different areas. Check the area on the listing. |
| `pick.none` | None of these |
| `pick.noneSub` | You can ask Fairsquare to add “{text}” next. |
| `pick.search` | Search covered buildings |
| `pick.searchPlaceholder` | Building name |
| `pick.announce` | {n} matching building / {n} matching buildings |
| `details.cta` | Compare price |
| `details.ctaBusy` | Comparing... |
| `alert.rentalContinue` | It's for sale, continue |
| `alert.anyway` | Type the details anyway |
| `alert.tryAnother` | Try another screenshot |
| `alert.tryAgain` | Try again |
| `field.offPlan` | Off-plan (not finished yet) |
| `field.offPlanHelp` | Off-plan listings are compared with off-plan sales only, all others with ready ones. |

### 6.5 Result

| Key | String |
|---|---|
| `band.above` | Above recent sales |
| `band.inline` | In line with recent sales |
| `band.below` | Below recent sales |
| `band.thin` | Not enough sales |
| `band.none` | Not covered yet |
| `result.sentenceAbove` | This listing asks AED {asking} per sq ft, {pct}% above the median of {count} {salesAdj} sales of {basis} {bedType} apartments in {building} (AED {median} per sq ft). |
| `result.sentenceBelow` | This listing asks AED {asking} per sq ft, {pct}% below the median of {count} {salesAdj} sales of {basis} {bedType} apartments in {building} (AED {median} per sq ft). |
| `result.sentenceInline` | This listing asks AED {asking} per sq ft, within {bandPct}% of the median of {count} {salesAdj} sales of {basis} {bedType} apartments in {building} (AED {median} per sq ft). |
| `result.source.live` | Sales from {from} to {to}, same building, {basis} {bedType} apartments, per sq ft. |
| `result.howTrigger` | How Fairsquare compares |
| `result.howBody` | Fairsquare takes the median price per sq ft of same-bedroom sales in this building over the {months} months to {to}. Within {bandPct}% either way counts as in line. With fewer than {minSales} sales it doesn't compare. |
| `result.howLink` | Read how Fairsquare compares |
| `result.another` | Compare another listing |
| `result.editDetails` | Edit details |
| `thin.h2` | Too few sales to compare yet |
| `thin.body` | Only {count} {salesAdj} {sale/sales} of {basis} {bedType} apartments in {building} in the {months} months to {to}. Fairsquare needs at least {minSales} to compare. |
| `thin.bodyZero` | No {salesAdj} sales of {basis} {bedType} apartments in {building} in the {months} months to {to}. Fairsquare needs at least {minSales} to compare. |
| `thin.progress` | {count} of the {minSales} sales needed |
| `none.h2` | We don't cover {building} yet |
| `none.body` | Fairsquare covers {n} buildings. Request this one and track it under Saved. |
| `none.cta` | Request it and track |
| `none.ctaDone` | Requested |
| `none.done` | Requested. It shows under Saved. {n} other people asked for it too. |
| `offplan.notice` | Compared with off-plan sales only. Payment plans can explain a different price. |
| `result.basis.ready` | ready |
| `result.basis.off_plan` | off-plan |
| `result.outliers` | {n} unusual sale left out / {n} unusual sales left out |
| `result.sizeLarger` | This listing is {pct}% larger than the typical sale here. DLD sizes may be measured differently, for example with or without balconies. |
| `result.sizeSmaller` | This listing is {pct}% smaller than the typical sale here. DLD sizes may be measured differently, for example with or without balconies. |
| `result.building` | Building: {building}, {area}. |
| `data.stale` | Fairsquare's sales data currently runs to {date}. Sales registered after that aren't included yet. |
| `data.loading` | Sales data is being loaded. Try again in a few minutes. |
| `data.runsTo` | Sales data runs to {date}. |
| `data.attribution` | Source: {dataset}, published as open data on Data.Dubai and used under the {licence}. |
| `data.dataset` | Dubai Land Department sales transactions |
| `data.licence` | Dubai Open Data Licence |
| `data.independent` | Fairsquare is independent. It is not affiliated with or endorsed by the Dubai Land Department or the Government of Dubai. |
| `area.withDld` | {area} (DLD area: {areaDld}) |

`{salesAdj}` is "registered".

### 6.6 Share and save

| Key | String |
|---|---|
| `share.cta` | Share |
| `share.whatsapp` | Send on WhatsApp |
| `share.download` | Download card |
| `share.copy` | Copy link |
| `share.copied` | Link copied |
| `share.downloaded` | Card downloaded |
| `share.text` | {building}, {listingType}, {size} sq ft, asking AED {price} (AED {asking} per sq ft), {pct}% {above/below} the median of {count} registered {bedType} sales in this tower, {months} months to {to}: AED {median} per sq ft. |
| `share.textInline` | {building}, {listingType}, {size} sq ft, asking AED {price} (AED {asking} per sq ft). Median of {count} registered {bedType} sales in this tower, {months} months to {to}: AED {median} per sq ft. |
| `share.textThin` | {building}, {listingType}, {size} sq ft, asking AED {price}: only {count} registered {bedType} {sale/sales} in this tower in {months} months, too few to compare. |
| `share.textThinZero` | {building}, {listingType}, {size} sq ft, asking AED {price}: no registered {bedType} sales in this tower in {months} months, too few to compare. |
| `share.recent` | Last 90 days: AED {median} per sq ft ({count} sales). |
| `share.source` | Source: DLD open data via Data.Dubai. Not a valuation. {url} |
| `share.fileName` | fairsquare-{building-slug}-{code}.png |
| `save.cta` | Save and track |
| `save.done` | Tracking |
| `save.announce` | Saved. New sales in {building} will show under Saved. |
| `save.helper` | New sales in this building show up under Saved. Fairsquare doesn't send messages yet. |

The WhatsApp text (result spec section 8.2) is one head, `share.text` (above or below), `share.textInline` or `share.textThin` (`share.textThinZero` with no sales at all), then `share.recent` only when the recent-sales line shows, then `share.source` with the link, joined by spaces. `{building}` is the listing's own text ("Aykon City Tower C"), `{listingType}` the listing as it describes itself ("ready 2-bed" or "off-plan 2-bed", just "2-bed" when it didn't say, as the fact line does), and `{size}` reads "about 815" after a size button (`fact.sizeAbout`). A not-covered comparison keeps `share.textNone`: the link only, no card.

### 6.7 Monthly cost

| Key | String |
|---|---|
| `cost.row` | About AED {monthly} a month with {down}% down |
| `cost.adjust` | Adjust |
| `cost.title` | Monthly cost estimate |
| `cost.for` | For an asking price of AED {price} |
| `cost.monthly` | About AED {monthly} a month |
| `cost.announce` | Monthly payment about AED {monthly} |
| `cost.loan` | Loan |
| `cost.upfront` | Cash upfront, about |
| `cost.breakdown` | Show the upfront costs |
| `cost.down` | Down payment |
| `cost.downValue` | {down}% (AED {amount}) |
| `cost.downSr` | {down} percent, AED {amount} |
| `cost.dld` | DLD transfer fee (4%) |
| `cost.reg` | Mortgage registration (0.25%) |
| `cost.agency` | Agency fee (2% plus VAT) |
| `cost.rate` | Interest rate (%) |
| `cost.rateHelp` | Assumed rate. Check with your bank. |
| `cost.rateErr` | Enter a rate between 1% and 12%. |
| `cost.term` | Term |
| `cost.termOptions` | 15 years / 20 years / 25 years |
| `cost.disclosure` | Estimate only, not an offer of credit. Expats usually need at least 20% down on a first home up to AED 5M, and 30% above that. |

### 6.8 Adviser and consent

| Key | String |
|---|---|
| `lead.h3` | Talk to a mortgage adviser |
| `lead.partnerLive` | Licensed by {PARTNER_REGULATOR}, licence {PARTNER_LICENCE}. |
| `lead.promiseLive` | {PARTNER_PROMISE} |
| `consent.v1` (version "optin-v1", unchanged) | Share my name, phone number and this listing with {PARTNER_NAME}, a licensed mortgage broker, so an adviser can contact me about financing. I can withdraw this at any time. |
| `lead.name` | Your name |
| `lead.mobile` | UAE mobile |
| `lead.mobileHelp` | For example +971 50 123 4567 |
| `lead.send` | Send my details to {PARTNER_NAME} |
| `lead.sending` | Sending... |
| `lead.nothingShared` | Nothing is shared unless you tick the box and press send. |
| `lead.errName` | Enter your name. |
| `lead.errMobile` | Enter a UAE mobile number, for example +971 50 123 4567. |
| `lead.errSend` | Couldn't send your details. Nothing was shared. Try again. |
| `lead.sentTitle` | Sent to {PARTNER_NAME} |
| `lead.sentName` | Name: {name} |
| `lead.sentMobile` | Mobile ending {last4} |
| `lead.sentListing` | Listing: {building}, {bedType}, AED {price} |
| `lead.sentAt` | Sent {date} at {time} |
| `lead.withdraw` | Withdraw this request |
| `lead.unavailable` | Talking to a mortgage adviser through Fairsquare isn't available yet. |

### 6.9 Saved, data and confirmations

| Key | String |
|---|---|
| `saved.h1` | Saved |
| `saved.intro` | Saved on this browser. New sales in these buildings show here. Fairsquare doesn't send messages yet. |
| `saved.listingsH2` | Listings |
| `saved.newSales` | {n} new sale / {n} new sales |
| `saved.then` | Saved {date}: {figure} vs {count} sales. |
| `saved.thenThin` | Saved {date}: too few sales to compare. |
| `saved.now` | Today: {figure} vs {count} sales. |
| `saved.open` | Open |
| `saved.more` | More actions for {building} |
| `saved.remove` | Remove |
| `saved.removed` | Removed {building}. |
| `saved.undo` | Undo |
| `saved.requestsH2` | Buildings you asked for |
| `saved.requestLine` | Requested {date}. {n} other people asked. |
| `saved.nowCovered` | Now covered. Compare again. |
| `saved.adviserH2` | Adviser request |
| `saved.adviserLine` | Sent to {PARTNER_NAME} on {date}. |
| `saved.adviserWithdrawn` | Withdrawn on {date}. {PARTNER_NAME} will be told to delete your details. |
| `saved.dataH2` | Your data |
| `saved.recoveryIntro` | Your list lives on this browser. To keep it on another browser, copy your recovery link. |
| `saved.recoveryCta` | Copy recovery link |
| `saved.recoveryDone` | Recovery link copied. Anyone with this link can see your saved list. |
| `saved.deleteCta` | Delete all my data |
| `saved.emptyH` | Nothing saved yet |
| `saved.emptyBody` | Save a comparison to see new sales in that building here. |
| `saved.emptyCta` | Compare a listing |
| `confirm.withdraw.title` | Withdraw your request? |
| `confirm.withdraw.body` | {PARTNER_NAME} will be told to delete your details. |
| `confirm.withdraw.yes` | Withdraw request |
| `confirm.withdraw.no` | Keep it |
| `confirm.withdraw.done` | Request withdrawn |
| `confirm.delete.title` | Delete everything Fairsquare stores for this browser? |
| `confirm.delete.body` | This deletes your saved listings and comparisons, unlinks your building requests from this browser, and removes your name and mobile from any adviser request. If you sent your details to {PARTNER_NAME}, they will be told to delete them. Links to your comparisons will stop working. You can't undo this. |
| `confirm.delete.yes` | Delete everything |
| `confirm.delete.no` | Keep my data |
| `confirm.delete.done` | Your data is deleted. |
| `confirm.delete.bodyNoPartner` | This deletes your saved listings and comparisons and unlinks your building requests from this browser. Links to your comparisons will stop working. You can't undo this. |

### 6.10 Coverage and How Fairsquare compares

| Key | String |
|---|---|
| `coverage.h1` | Buildings Fairsquare covers |
| `coverage.intro` | Fairsquare compares a listing when the building has at least 5 registered sales of that apartment type with the same completion (ready, or off-plan for an off-plan listing) in the last 12 months of the data, not counting unusual sales. |
| `coverage.search` | Search buildings |
| `coverage.matches` | {n} building matches / {n} buildings match |
| `coverage.latest` | {area}. Latest sale {date}. |
| `coverage.typeLine` | {bedType}: {ready} ready, {offPlan} off-plan |
| `coverage.enoughBoth` | Enough ready and off-plan sales |
| `coverage.enoughReady` | Enough ready sales |
| `coverage.enoughOffPlan` | Enough off-plan sales |
| `coverage.thin` | Too few sales |
| `coverage.noMatch` | No covered building matches "{q}". |
| `coverage.requestQ` | Request "{q}" |
| `coverage.requestH2` | Don’t see your building? |
| `coverage.requestLabel` | Building name and area |
| `coverage.requestCta` | Request this building |
| `coverage.requestDone` | Requested. It shows under Saved. |
| `coverage.requestErr` | Type a building name. |
| `how.h1` | How Fairsquare compares |
| `how.intro` | Fairsquare compares an asking price with recent sales of the same apartment type in the same building. It is not a valuation. |
| `how.whatH2` | What Fairsquare compares |
| `how.what` | Fairsquare divides the asking price by the size to get a price per sq ft. It compares that with the median price per sq ft of sales in the same building with the same number of bedrooms. Comparing per sq ft evens out small size differences. |
| `how.rulesH2` | The rules |
| `how.rules` | Same building. / Same number of bedrooms (a studio counts as 0). / Sales in the last 12 months of the data. / At least 5 sales, or Fairsquare doesn't compare. / The median, so one unusual sale can't move the result much. / Within 5% of the median counts as in line. More than 5% is above or below. |
| `how.outH2` | What it leaves out |
| `how.out` | Floor, view, condition, parking, furnishing and off-plan payment plans. Any of these can justify a different price. |
| `how.dataH2` | Where the data comes from |
| `how.dataLive` | The sales Fairsquare uses run from {from} to {to}. Fairsquare last loaded them on {date}. |
| `how.readH2` | Who reads your screenshot |
| `how.read` | Claude, an AI model made by Anthropic, reads the building, bedrooms, size and price. Fairsquare doesn't store the screenshot. You can check and change every value before comparing. |
| `how.valuationH2` | Not a valuation |
| `how.valuation` | A comparison with past sales is not a valuation. For a valuation, ask a RERA-certified valuer. |
| `coverage.window` | Counts are registered sales from {from} to {to}, most sales first. |
| `coverage.searchHelp` | A building or area name, at least 2 letters. |
| `coverage.counts` | {ready} ready and {offPlan} off-plan sales |
| `coverage.colReady` | Ready sales |
| `coverage.colOffPlan` | Off-plan sales |
| `coverage.showing` | Showing {first} to {last} of {total} building / Showing {first} to {last} of {total} buildings |
| `coverage.pages` | Pages |
| `coverage.prev` | Previous page |
| `coverage.next` | Next page |
| `coverage.loadFailed` | Couldn't load the buildings just now. Try again. |
| `how.dataIncluded` | Included: sales registered with the Dubai Land Department of apartments for living in, from studios to 7 bedrooms, ready and off-plan. / Left out: mortgages, gifts, leases, land, villas, offices, shops, penthouses and single rooms. / Left out: deals that sold several apartments at once, and 3 or more sales at the same price in one building on one day. / Left out: sales with no building name, and sizes or prices per sq ft far outside the usual range. |
| `how.dataBasis` | Ready and off-plan sales are compared separately. A listing marked off-plan is compared only with off-plan sales; every other listing with ready ones. |
| `how.dataDifc` | Buildings in DIFC aren't in this data: DIFC registers its own property sales, not the Dubai Land Department. |
| `how.dataSizes` | Sizes are the registered sizes. They may be measured differently from a listing, for example with or without balconies, so Fairsquare points out a listing that is more than 20% larger or smaller than the typical sale. |
| `how.dataRefresh` | Fairsquare updates the sales by hand from the latest file on Data.Dubai, about once a month. Sales registered after the last date above aren't included yet. |

### 6.11 Privacy

| Key | String |
|---|---|
| `privacy.h1` | Privacy |
| `privacy.storesH2` | What Fairsquare stores |
| `privacy.stores` | An anonymous id in a cookie, so your saved list works without an account. / The numbers from each comparison: building, bedrooms, size, price and result. / Listings you save and buildings you request. / Simple usage events, such as when a comparison is shared or a cost estimate is opened, linked to the anonymous id. / Your name and mobile, only if you send them to {PARTNER_NAME}, with the consent text you agreed to and when. |
| `privacy.howLong` | The cookie lasts 400 days from your last visit. Comparisons, saved listings, requests and usage events stay until you delete them under Saved. A removed saved listing is erased after 30 days. If you withdraw an adviser request or delete your data, your name and mobile are erased; a record that you agreed and later withdrew is kept, without them. |
| `privacy.notH2` | What Fairsquare doesn't store |
| `privacy.not` | Your screenshots. They are sent to Claude to read and then discarded. |
| `privacy.whoH2` | Who sees your data |
| `privacy.who` | Anthropic processes your screenshot to read it. {PARTNER_NAME} gets your name, mobile and the listing only after you tick the box and press send. Nobody else. |
| `privacy.cookiesH2` | Cookies |
| `privacy.cookies` | One signed, anonymous id cookie. No advertising or tracking cookies. |
| `privacy.choicesH2` | Your choices |
| `privacy.choices` | Withdraw an adviser request or delete all your data at any time under Saved. |
| `privacy.howLongNoPartner` | The cookie lasts 400 days from your last visit. Comparisons, saved listings, requests and usage events stay until you delete them under Saved. A removed saved listing is erased after 30 days. |
| `privacy.whoNoPartner` | Anthropic processes your screenshot to read it. Nobody else. Talking to a mortgage adviser through Fairsquare isn't available yet, so Fairsquare doesn't ask for your name or mobile. |
| `privacy.choicesNoPartner` | Delete all your data at any time under Saved. |

### 6.12 Not found and errors

| Key | String |
|---|---|
| `notFound.h1` | This page doesn't exist |
| `notFound.body` | The link may be mistyped or out of date. |
| `notFound.cta` | Compare a listing |
| `cNotFound.h1` | This comparison link doesn't work |
| `cNotFound.body` | It may be mistyped, or the comparison was deleted. |
| `error.h1` | Something went wrong on our side |
| `error.body` | Try again. If it keeps happening, type the details by hand on the home page. |
| `error.retry` | Try again |
| `error.home` | Go to the home page |
| `claudeOff.notice` | Screenshot reading is off right now. Typing the 4 details takes about 20 seconds. |
| `outcome.notListing` | That doesn't look like a property listing. Try a screenshot that shows the price. |
| `outcome.rental` | This looks like a rental listing. Fairsquare compares sale prices only. |
| `outcome.notApartment` | This looks like a villa or townhouse. Fairsquare compares apartments only for now. |
| `error.refused` | Claude couldn't read this one. Type the details instead. |
| `error.cutShort` | The reading was cut short. Try again, or type the details. |
| `error.badImage` | That image couldn't be read. Try a JPEG or PNG screenshot. |
| `error.timeout` | Reading took too long. Try again, or type the details. |
| `error.offline` | You're offline. Connect and try again, or type the details. |
| `error.readFailed` | Reading failed. Try again, or type the details. |
| `error.compareFailed` | Couldn't compare just now. Try again. |
| `error.shareFailed` | Couldn't open sharing here. Download the card or copy the link instead. |
| `error.clipboard` | Copy didn't work here. Press and hold the link to copy it. |
| `rate.burst` | You've read a lot of screenshots in a short time. Wait {n} minutes, or type the details. |
| `rate.daily` | You've read a lot of screenshots today. Type the details, or try again tomorrow. |
| `rate.busy` | Claude is busy right now. Try again in a minute, or type the details. |
| `rate.retryIn` | Try again in {n} s |
| `rate.spam` | Too many requests from this browser. Wait a minute and try again. |
| `rate.dailyCap` | Fairsquare has read as many screenshots as it can today. Type the details instead. |

`ERROR_COPY` (ARCHITECTURE section 4.1) maps server error codes onto these keys; strings that exist only on the server (for example `consent_required`) are listed in that table and added to `copy.ts` under `apiError.{code}`.

### 6.13 Share page and admin

| Key | String |
|---|---|
| `c.date` | Compared on {date} |
| `c.h1` | {building}, {bedType} |
| `c.today` | Today: {figure} vs {count} sales. |
| `c.cta` | Compare a listing you're looking at |
| `c.ogTitle` | {building} {bedType}: {verdictPhrase} |
| `c.ogDescLive` | {count} registered sales in {months} months. {recentShort}Not a valuation. |
| `c.ogDescNone` | Not covered yet. Not a valuation. |
| `c.ogAlt` | Fairsquare comparison: asking AED {asking} per sq ft, median AED {median} of {count} registered sales. |
| `admin.signIn` | Sign in |
| `admin.password` | Password |
| `admin.wrong` | That password is wrong. |
| `admin.locked` | Too many tries. Wait 15 minutes. |
| `admin.signOut` | Sign out |
| `admin.registerCta` | Register sale |
| `admin.registered` | Sale registered |
| `admin.impact` | The {bedType} median in {building} moves from AED {old} to AED {new} per sq ft. {n} saved listings will show a new sale. |
| `admin.csvChoose` | Choose CSV file |
| `admin.csvTemplate` | Download template |
| `admin.csvDry` | {ok} rows ready. {bad} rows rejected. |
| `admin.csvImport` | Import {ok} sales |
| `admin.csvDone` | {ok} sales imported |
| `admin.deleteSale.title` | Delete this sale? |
| `admin.deleteSale.body` | It changes the comparison for everyone looking at this building. |
| `admin.deleteSale.yes` | Delete sale |
| `admin.deleteSale.no` | Keep sale |
| `admin.markCovered` | Mark as covered |
| `admin.reveal` | Reveal mobile for {name} |
| `admin.export` | Export CSV |
| `admin.title` | Fairsquare admin |
| `admin.tabs` | Overview / Leads / Requests / Sales data / Quality |
| `admin.range` | 7 days / 30 days / 90 days |
| `admin.kpi` | Comparisons / Reads / Read failures / Shares created / Share page views / Comparisons from shares / Cost estimates opened / Adviser requests / Withdrawn |
| `admin.funnel` | New visitors / Reads / Comparisons / Shares / Share views / From shares / Leads |
| `admin.kFactor` | K-factor: {k} comparisons per comparison |
| `admin.showTable` | Show as table |
| `admin.leadStatus.new` | New |
| `admin.leadStatus.sent` | Sent to partner on {date} |
| `admin.leadStatus.withdrawn` | Withdrawn on {date}. Tell the partner. |
| `admin.leadStatus.notified` | Withdrawn on {date}. Partner told. |
| `admin.markSent` | Mark sent to partner |
| `admin.partnerTold` | Partner told |
| `admin.salesTabs` | Sales / Register a sale / Buildings / Import CSV |
| `admin.reference` | Reference (optional) |
| `admin.addBuilding` | Add building |
| `admin.addAlias` | Add alias |
| `admin.csvKind` | Sales / Buildings / Aliases |
| `admin.qualityEdited` | Fields people changed after reading |
| `admin.qualityFailures` | Read failures |
| `admin.qualityMedian` | Median read time: {s} s |
| `admin.freshness` | Latest sale by building |

### 6.14 Scene, questions and result headline

Added by `docs/REDESIGN.md` section 9. "Weigh" appears only in `home.h1` and `scene.weighing`; buttons, nav and the stamp still say compare. `{keys}` is "Ctrl V" or "Cmd V" (from `home.kbdCtrl`, `home.kbdCmd`, `home.kbdV`). The scene's questions, failure titles and notes are set in the serif at display sizes, so they use typographic apostrophes and quotes (’ “ ”). On screen, "AED" stays on the same line as its amount and a size stays with "sq ft" (the components join them with no-break spaces; the strings and the plain-text builders keep ordinary spaces). The read line is gone: the fact line (section 6.15) states what was read, and the evidence line names the DLD building.

| Key | String |
|---|---|
| `home.dropScale` | Drop a screenshot on the scale |
| `home.pasteKeys` | or paste it with {keys} |
| `home.dataSentence` | {building} had the most registered sales of ready {bedType} apartments in the {months} months to {to}: {count}, at a median of AED {median} per sq ft. |
| `home.dataRange` | Registered sales from {from} to {to}. |
| `scene.readingText` | Reading the listing text |
| `scene.weighing` | Weighing it against registered sales |
| `scene.checking` | Looking for registered sales |
| `scene.slowMatch` | Still finding the building. |
| `scene.slowCompare` | Still comparing. |
| `scene.kept` | Your screenshot is still here. |
| `scene.keptText` | Your listing text is still here. |
| `scene.reducedHint` | This takes about 5 to 20 seconds. |
| `scene.read` | Read: {bedType}, {size} sq ft, AED {price}. |
| `scene.labelListing` | this listing, per sq ft |
| `scene.labelSales` | registered sale / registered sales |
| `scene.labelMedian` | median of {count} registered sales |
| `scene.partialH` | Fairsquare could only read part of this listing. |
| `scene.partialBody` | Type the details to finish, or try another screenshot. |
| `ask.buildingH` | Which building is this? |
| `ask.buildingSays` | The listing says “{text}”. |
| `ask.buildingNameH` | Which building is it in? |
| `ask.bedsH` | How many bedrooms? |
| `ask.sizeH` | What’s the size? |
| `ask.priceH` | What’s the asking price? |
| `ask.psfH` | Check the size and price. |
| `ask.notIn` | It isn’t in the screenshot. |
| `ask.notInText` | It isn’t in the listing text. |
| `ask.continue` | Continue |
| `ask.typeAll` | Type all the details instead |
| `ask.rentalH` | This looks like a rental listing. |
| `ask.rentalBody` | Fairsquare compares sale prices only. |
| `ask.notListingH` | That doesn’t look like a property listing. |
| `ask.notListingBody` | Try a screenshot that shows the price. |
| `ask.villaH` | This looks like a villa or townhouse. |
| `ask.villaBody` | Fairsquare compares apartments only for now. |
| `fail.timeout` | Reading took too long. |
| `fail.cutShort` | The reading was cut short. |
| `fail.read` | Reading failed. |
| `fail.refused` | Claude couldn’t read this one. |
| `fail.image` | That image couldn’t be read. |
| `fail.imageHint` | Try a JPEG or PNG screenshot. |
| `fail.busy` | Claude is busy right now. |
| `fail.off` | Screenshot reading is off right now. |
| `fail.offHint` | Typing the 4 details takes about 20 seconds. |
| `fail.limit` | That’s the limit for now. |
| `fail.offline` | You’re offline. |
| `fail.compare` | Couldn’t compare just now. |
| `result.headAbove` | {pct}% above |
| `result.headBelow` | {pct}% below |
| `result.headInline` | In line |
| `result.headRest` | registered sales |
| `result.headInlineRest` | with registered sales |
| `details.h2Typed` | Type the details |
| `details.back` | Back to the result |
| `how.figCaption` | How the balance reads a listing |
| `how.figListing` | Left: this listing, its asking price divided by its size. |
| `how.figSales` | Right: registered sales of the same apartment type in the same building, over {months} months. |
| `how.figBand` | Within {bandPct}% of their median either way counts as in line. |

### 6.15 Result: fact line, market scale, sales list and share

Added by the result spec (section 10; it amends `docs/REDESIGN.md`). The numbers come from `scaleModel()` (`src/lib/result/scale-model.ts`). "registered sales" is the noun throughout. Never write, in these keys or the sentences built from them: checked, verified, approved, fair price, worth, value, overpriced, deal, estimate, forecast (except in "not a valuation or a forecast"), average (the figure is a median), outliers, trimmed or percentile; no middle dots and no arrows. The word "fair" appears only inside "Fairsquare". `{bedTypePlural}` is "2-beds" or "studios". `{dld}` is the DLD building name verbatim ("Aykon City (2) -Tower C"); `{building}` in `fact.line1` is the listing's own text. `{pctParen}` is " (1.4%)" in line (also when every sale is on one side: the in-line headline carries no figure) and empty above or below, where the headline carries the figure. `result.announce` is what the live region says at the settle and at each re-settle (RESULT_SPEC 2.7): `{verdict}` is the headline as one string, `{listingType}` the listing as it describes itself ("ready 2-bed", or "2-bed" when it didn't say), `{above/below}` follows the sign of the difference, and `card.recentLower` or `card.recentHigher` follows when the recent-sales line shows; `result.announceSame` when the difference rounds to 0.0%. Too few and not covered announce their sentence. In `scale.summaryQuantile` (more than 80 sales, drawn as 40 dots) `{per}` is the sales a dot stands for and `{k}` of `{n}` counts the full set. `{minSales}` in `evidence.defLimited` is the comparison's own minimum. `{verdictPhrase}` in `c.ogTitle` is one of the `c.ogVerdict*` strings, and `{recentShort}` in `c.ogDescLive` is `c.ogRecentLower` or `c.ogRecentHigher` plus a space when the recent-sales line shows, else empty; a not-covered comparison's og:description is `c.ogDescNone` (no count, so it never reads as "0 sales"). Values with " / " are lists (`tList`) or "singular / plural" (`tPlural`: `list.h`, `evidence.setAsideN`).

| Key | String |
|---|---|
| `fact.line1` | {building}, {area}. |
| `fact.line1NoArea` | {building}. |
| `fact.line2` | {basis} {bedType}, {size} sq ft, AED {price}. |
| `fact.line2NoBasis` | {bedType}, {size} sq ft, AED {price}. |
| `fact.sizeAbout` | about {size} |
| `fact.edit` | Edit |
| `fact.editSr` | Edit the details |
| `scene.statusMatch` | In DLD records as {building}, {area}. |
| `scene.statusSales` | {count} registered sales of {basis} {bedTypePlural} in the {months} months to {to}. |
| `result.gapAbove` | The asking price is AED {gap} per sq ft above the median{pctParen}, and higher than {k} of the {n} sales. |
| `result.gapBelow` | The asking price is AED {gap} per sq ft below the median{pctParen}, and lower than {k} of the {n} sales. |
| `result.gapZero` | The asking price is the same as the median, and higher than {k} of the {n} sales. |
| `result.aboveAll` | The asking price is AED {gap} per sq ft above the median{pctParen}, and higher than all {n} sales. The highest was AED {max} per sq ft, on {date}. |
| `result.belowAll` | The asking price is AED {gap} per sq ft below the median{pctParen}, and lower than all {n} sales. The lowest was AED {min} per sq ft, on {date}. |
| `result.announce` | {verdict}. {building}, {listingType}, AED {asking} per sq ft, {pct}% {above/below} the median of {count} registered sales. |
| `result.announceSame` | {verdict}. {building}, {listingType}, AED {asking} per sq ft, the same as the median of {count} registered sales. |
| `result.recentLower` | Recent sales are lower. The {n} since {date} have a median of AED {m} per sq ft. This asking price is {dir} than {k} of them. |
| `result.recentHigher` | Recent sales are higher. The {n} since {date} have a median of AED {m} per sq ft. This asking price is {dir} than {k} of them. |
| `result.premiumLink` | Ask what explains the premium |
| `result.listingCheck` | Before you pay a deposit, check the listing is live. Ask for its Trakheesi permit number, or scan the Madmoun QR code on the ad. |
| `result.howToCheck` | How to check |
| `result.howToCheckSteps` | Ask the agent for the Trakheesi permit number shown on the ad. / Scan the Madmoun QR code on the ad with your phone camera. It opens the permit details from the Dubai Land Department. / Check that the building, size and price on the permit match the listing. |
| `evidence.line` | {strength} evidence. {n} registered sales of {basis} {bedTypePlural} in {dld}, {from} to {to}, the latest on {latest}. {setAside} Not a valuation. |
| `evidence.strong` | Strong |
| `evidence.moderate` | Moderate |
| `evidence.limited` | Limited |
| `evidence.defStrong` | Strong evidence: 20 or more sales, at least 3 of them in the last 90 days, and the middle half of prices within 20% of the median. |
| `evidence.defHere` | Here: {n} sales, {recent} in the last 90 days, middle half AED {q1} to {q3} per sq ft ({spread}% of the median). |
| `evidence.defModerate` | Moderate evidence: 10 to 19 sales, or 20 or more that miss one of those tests. |
| `evidence.defLimited` | Limited evidence: {minSales} to 9 sales. One or two new sales can move the median. |
| `evidence.defCounts` | Fairsquare counts registered sales. It is not a valuation. |
| `evidence.setAsideNone` | None set aside. |
| `evidence.setAsideN` | {n} unusual sale set aside. / {n} unusual sales set aside. |
| `evidence.wrongBuilding` | Wrong building? |
| `evidence.thinLine` | DLD building: {dld}. Not a valuation. |
| `scale.title` | Where this asking price sits among {n} registered sales |
| `scale.summary` | Each dot is a registered sale of {article} {basis} {bedType} in {dld}, {from} to {to}. Lowest AED {min}, highest AED {max} per sq ft. Median AED {median}. This asking price, AED {asking}, is {dir} than {k} of them. |
| `scale.summaryRecent` | The {n} sales since {date} are filled; their median is AED {m}. |
| `scale.summaryQuantile` | Each dot is about {per} registered sales of {article} {basis} {bedType} in {dld}, {from} to {to}. Lowest AED {min}, highest AED {max} per sq ft. Median AED {median}. This asking price, AED {asking}, is {dir} than {k} of the {n} sales. |
| `scale.summaryRecentQuantile` | A dot is filled when at least half of its sales are since {date}. The {n} sales since then have a median of AED {m}. |
| `scale.unit` | AED per sq ft. |
| `scale.unitOffPlan` | AED per sq ft, off-plan sales. |
| `scale.recent` | since {date} |
| `scale.older` | earlier |
| `scale.band` | within {bandPct}% of the median, AED {lo} to {hi} |
| `scale.median` | Median |
| `scale.stampAsking` | ASKING |
| `scale.readout` | {date}: {size} sq ft, AED {price}, AED {psf} per sq ft. |
| `scale.readoutQuantile` | About {k} sales near AED {psf} per sq ft. |
| `scale.quantile` | Each dot is about {k} sales. |
| `list.h` | {n} registered sale / {n} registered sales |
| `list.newest` | Newest first |
| `list.byPsf` | By price per sq ft |
| `list.colDate` | Registered |
| `list.sameSize3` | The {k} newest sales of the same size (within 3% of {size} sq ft) registered at AED {lo} to AED {hi}. |
| `list.sameSize1` | The newest sale of the same size (within 3% of {size} sq ft) registered at AED {p} on {date}. |
| `list.sameSizeTag` | same size |
| `list.setAsideTag` | set aside |
| `list.showAll` | Show all {n} sales |
| `offer.h` | Before you make an offer |
| `offer.spread` | Floor, view, condition and furnishing aren't in registered sales, and they can explain part of the spread. |
| `offer.premium` | {k} of the {n} sales were at AED {lo} per sq ft or more. |
| `offer.ask` | Ask the agent about |
| `offer.items` | Floor and view / Vacant or tenanted, and until when / Service charge per sq ft / Upgrades since handover / The Trakheesi permit number |
| `ask.sizeCommon` | Usual {bedType} sizes in {building} |
| `ask.sizeChip` | About {size} sq ft |
| `ask.sizeChipSales` | {n} sales |
| `ask.sizeOr` | Or type it |
| `ask.completionH` | Is it ready or off-plan? |
| `ask.completionOptions` | Ready / Off-plan |
| `edit.h` | Change a detail |
| `edit.typeAll` | Type all the details |
| `share.more` | More ways to share |
| `share.image` | Send the card image |
| `share.copyText` | Copy text |
| `card.compared` | Compared {date} |
| `card.asking` | Asking, per sq ft |
| `card.median` | Median of {n} sales, per sq ft |
| `card.recent` | Last 90 days: median AED {m} per sq ft ({n} sales). |
| `card.dots` | Each dot is one registered sale. Filled: since {date}. |
| `card.dotsNoRecent` | Each dot is one registered sale. |
| `card.dotsQuantile` | Each dot is about {k} registered sales. Filled: at least half since {date}. |
| `card.dotsQuantileNoRecent` | Each dot is about {k} registered sales. |
| `card.source` | Registered sales, {from} to {to}. DLD open data via Data.Dubai. Not a valuation. Fairsquare is independent of DLD. |
| `card.link` | See all {n} sales: {host}/c/{code} |
| `c.ogVerdictAbove` | {pct}% above registered sales |
| `c.ogVerdictBelow` | {pct}% below registered sales |
| `c.ogVerdictInline` | in line with registered sales ({figure}) |
| `c.ogRecentLower` | Recent sales lower. |
| `c.ogRecentHigher` | Recent sales higher. |
| `offplan.mismatch` | This building has {n} ready {bedType} sales. Is the listing ready? |
| `offplan.compareReady` | Compare with ready sales |
| `provenance.basis` | This compares an asking price with registered sale prices, fees excluded on both. It is not a valuation or a forecast. |
| `provenance.lag` | Data to {date}; the latest weeks may be incomplete. |
| `thin.notHighLow` | This doesn’t mean the price is high or low. |
| `none.noMatch` | We couldn’t match “{building}” to a building in Dubai Land Department sales data. DLD may list it under the project or developer name. |
| `share.openCard` | Open the share card |
| `result.howToCheckLink` | Read about the Madmoun QR code |
| `list.sortLabel` | Sort the sales |
| `list.colNote` | Note |
| `edit.size` | Size |
| `edit.price` | Asking price |
| `edit.completion` | Ready or off-plan |
| `edit.viewScreenshot` | View screenshot |
| `share.textCopied` | Text copied |
| `card.listing` | {listingType}, {size} sq ft, asking AED {price} |
| `card.askingLabel` | Asking {asking} |
| `card.recentLower` | Recent sales are lower. |
| `card.recentHigher` | Recent sales are higher. |
| `card.found` | Registered sales found |
| `card.foundValue` | {count} of the {minSales} needed |
| `card.thinLine` | Only {n} registered sale of {basis} {bedTypePlural} in this building in {months} months. / Only {n} registered sales of {basis} {bedTypePlural} in this building in {months} months. |
| `card.thinZero` | No registered sales of {basis} {bedTypePlural} in this building in {months} months. |
| `card.linkOnly` | See it on Fairsquare: {host}/c/{code} |
| `card.linkShort` | {host}/c/{code} |
| `card.alt` | Fairsquare comparison card. {building}, {listingType}, {size} sq ft, asking AED {price}. {verdict}. Asking AED {asking} per sq ft, median of {count} sales AED {median} per sq ft. Not a valuation. |
| `card.altThin` | Fairsquare comparison card. {building}, {listingType}, {size} sq ft, asking AED {price}. Too few sales to compare yet: {count} of the {minSales} registered sales needed. Not a valuation. |
| `og.listing` | {listingType}, {size} sq ft, AED {price} |
| `og.figures` | Asking AED {asking}, median AED {median} per sq ft, {count} registered sales |
| `og.figuresThin` | Asking AED {asking} per sq ft, {count} of the {minSales} registered sales needed |
| `og.recent` | Last 90 days: AED {median} per sq ft ({count} sales) |
| `og.source` | DLD open data via Data.Dubai. Data to {date}. Not a valuation. |
| `stamp.inLine` | IN LINE |
| `stamp.above` | ABOVE |
| `stamp.below` | BELOW |
| `stamp.tooFew` | TOO FEW |

The six rows from `thin.notHighLow` to `list.colNote` are strings the result needs beyond the section 10 table: the too-few note (section 6.6), the not-covered sentence (6.7), the desktop card preview's name (3.2), the How to check link (6.4), and the sales list's sort group and note column (5). The rows after them serve the Change a detail sheet (section 7: its row labels; the screenshot row reuses `read.thumb`), the "More ways to share" drawer (8.2), the share card (8.1: `{listingType}` is capitalised there, "Ready 2-bed", and is just "2-bed" when the listing didn't say ready or off-plan; `card.thinLine` is "singular / plural"; under the mini scale `card.dots`, or `card.dotsNoRecent` with no filled dot, or `card.dotsQuantile` / `card.dotsQuantileNoRecent` with more than 80 sales) and the OG image (8.3), and the stamp's row A verdict word (8.1). The read line's keys (`result.readImage`, `result.readText`, `result.readTyped`, `result.readBody`, `result.readCompared` and `read.blank`) are retired with it. With /c on the market scale, the gap sentence and the sales list, these are retired too: `result.sub`, `result.salesRange`, `result.chartBand`, `result.chartMedian`, `result.chartListing`, `result.chartAxis`, `result.chartSummary`, `c.sentence` and `c.salesTrigger`; with the stamped sheet and the old card, `result.expand`, `result.sheetAlt`, `result.contactTip`, `result.contactAction`, `result.trimLabel`, `result.salesH3`, `result.salesCaption.live`, `result.thisListing`, `result.newSale`, `result.caveat`, `share.preparing`, `share.title` and `share.linkLabel`. `share.cta` now reads "Share" (the too-few bar, section 6.6).

### 6.16 Similar buildings (the second tier)

Added with the similar-buildings comparison (REAL_DATA.md section 15). It shows under "Too few sales to compare yet" only, and only when the stored comparison carries a shown `similar` entry; `similarLines()` in `src/lib/copy.ts` builds every sentence from that entry, so /c reads the same later. The headline of the result stays `thin.h2`. This tier is weaker evidence than a same-building comparison and must look it: its own section, a range and never one figure, the outcome in words only (within, above or below the range, no percentage), and `similar.weaker` on every result. It is never a price for the unit.

"Similar buildings" is the tier's internal name (this heading, the keys, the code). **No string on a page says "similar"** (review of 19 Nov 2026): the other buildings are matched on place, bedrooms and basis only, and on real data their medians are often more than twice apart. The page says "other buildings in" the project, community or area, states the span of their medians (`similar.srcSpan`) and says they are not matched on size or price level (`similar.weaker`). A test keeps the word out of every key.

Never write, in these keys or the sentences built from them: estimate, estimated, forecast, predict, valuation (except "Not a valuation"), worth, value, fair price, overpriced, deal, checked, verified, approved, average (the figures are medians), outliers, trimmed, percentile or "model"; no middle dots and no arrows. The noun is "registered sales".

`{low}` and `{high}` are the range, rounded to AED 10 per sq ft. `{building}` is the building as shown. `{to}` is the data date the 12 months end at. `similar.intro` and `similar.range` read as one paragraph ("They" in the second is the registered sales of the first). `similar.sources` lists what the range is built from, joined with commas and `similar.and`: `similar.srcOwn` (the building's own sales in the 12 months), `similar.srcOlder` (`{from}` is three years before the data date), `similar.srcOtherBeds` and `similar.srcRef` (`{n}` sales in `{k}` other buildings; `{place}` is `similar.placeProject`, or `similar.placeNamed` with the community or area name, or `similar.placeArea`); each is "singular / plural" (`tPlural`; `similar.srcRef` by `{k}`). With two or more other buildings `similar.srcSpan` follows (`{lo}` and `{hi}` are the lowest and the highest of all their medians, `comparableSpan`). The heading is always `similar.h`. With no other building in the range the last line is `similar.weakerOwn` and the share text says `similar.shareWhereOwn`. A range is never worded from the building's 12-month sales alone, nor from other buildings alone (`shownSimilar`): "looked at more registered sales" must be true. `similar.tierClose` is a range of at most about 10% either way, `similar.tierBroad` up to about 20%. `{held}` and `{heldLater}` in `similar.tested` come from the backtest stored with the comparison (8 and 7 for the constants of 19 Nov 2026: each the lower of its two measured shares, rounded down). `how.similarH` and `how.similarBody` are for How Fairsquare compares.

**The project route (19 Nov 2026, REAL_DATA.md section 15.8).** For a building that is not in the data, the section can show under "Not covered yet" when the listing is off-plan, studio to 3-bed, and its words name one project of the data with other buildings that have registered sales of the same type. Its keys are `similar.project*`: the heading is `similar.projectH` ("A range from other buildings in the {project} project"), never `similar.h`; `similar.projectIntro` says the building has no registered sales in the data; `similar.projectRange` gives the range; `similar.projectSrc` names the count of sales and other buildings in the project (singular / plural by `{k}`); `similar.projectWeaker` repeats that the building itself has no registered sales in the data, says the other buildings are weaker evidence and ends "Not a valuation."; the definitions add `similar.projectReach` (why the range reaches further up than down) and `similar.projectTested` (`{held}` is the route's own tested share, 7 for the constants of 19 Nov 2026). The not-covered headline, sentence and request button stay as they are. The share text puts `similar.projectShare` before `share.textNone`; the preview uses `similar.projectOgDesc`, `similar.projectOgLine` and `similar.projectOgAlt`. A not-covered result still has no card. `{project}` is the project's name as shown ("Azizi Venice"), never a building of it.
**The section on the result (stage 4, 19 Nov 2026).** `SimilarSection` (`src/components/result/similar-section.tsx`) sits in the result's below slot under the unchanged too-few explanation (the tally, the sentence, the DLD building line), and on /c under the same summary with its heading one level up (h2). It renders nothing unless the stored comparison carries a shown range: a refusal, an entry of another version or no entry leaves "Too few sales to compare yet" and "Not covered yet" exactly as they were (a test compares the markup). A range that would rest on the building's 12-month sales alone, or whose own sales disagree with it, is a refusal too (REAL_DATA.md section 15.3). "Not covered yet" shows the section only for the project route below; an area or a community alone never gives a range. No question about the area is asked: an answer could not change the result while an area alone is never shown.

Order, top to bottom: a hairline; the heading (`similar.h`) in `type-title`; the range scale and its legend; `similar.intro` and `similar.range` as one paragraph in Archivo body; the outcome (`similar.within`, `.above`, `.below`) in Archivo body 500; the evidence line in Archivo 14/20 pencil, which starts with the tier (`similar.tierClose` or `similar.tierBroad`, underlined ink 500) and continues with `similar.sources`, `similar.srcSpan` and `similar.weaker`; then the list toggle. The tier opens the definitions (a Popover from 1024px, named by the tier with `aria-label`; the info sheet on phones): `similar.defClose`, `similar.defBroad`, `similar.tested`, `similar.limits`. Weaker than a same-building result on purpose: no stamp, no percentage, no verdict colour, no headline of its own, Archivo body where a verdict uses the Newsreader lead.

**The range scale** (`src/lib/result/similar-scale.ts` gives every number; one SVG unit is one CSS px). It is the market scale's axis in a weaker form: the same 1px ink axis, the same dot sizes (7px on phones, 9px from 768px), the same indigo pin and diamond for the asking price, but:

- the shaded zone (`--chart-4`) is the stored range and its ends are dashed (`--input`, 3 3); the in-line zone of a verdict has solid ends. The two ends are labelled under the axis in ink 600 (`similar.endsJoined` as one label when they would touch). There is no median label and no fulcrum: the range has no middle figure;
- a hollow ring is one other building at the median of its registered sales; a filled ink dot is one registered sale of this building. Shape carries the difference, not colour. When a column would pass six marks, one ring stands for up to `k` buildings (`similar.legendOtherK`, "up to": a column of n buildings draws ceil(n / k) rings, so a ring can stand for fewer, and the readout gives the exact count). With many buildings most columns are then one ring tall and the row of rings shows where buildings are, not how many: the list has the counts. A building further than 1.6 times from the range's ends is not drawn, so the range keeps its width on a phone; the legend counts those (`similar.legendOff`) and the list names them. When fewer buildings are stored than the range read (200 at most), the legend and the summary say so (`similar.scaleCapped`);
- the asking price is a plain label, `similar.asking` and the figure, beside the pin. No ASKING stamp;
- the legend: the unit, the ring, the dot, then the range swatch with `similar.legendRange`.

Accessibility: the drawing and its labels are aria-hidden; the group is named by `similar.scaleTitle` and described by the summary (`similar.scaleSummary`, `similar.scaleOthers`, `similar.scaleOwn`), which says everything the drawing shows. It is one tab stop when it has marks: Left and Right step in price order, Home and End jump to the ends, Esc restores the legend; a tap or drag picks the nearest mark. The readout (`similar.readout`, `similar.readoutK`, `similar.readoutOwn`) replaces the legend's first line and is announced politely; on phones that line keeps room for two lines (40px), so a long building name does not move the text below. At the settle the live region reads the too-few sentence, then `similar.intro`, `similar.range` and the outcome. No motion of its own: the section fades in with the rest of the result, and at once under reduced motion.

**The list** (`similar.listShow`, closed until asked for, never behind an ask): a table of the other buildings by name, most sales first, with `similar.colBuilding`, `similar.colSales` and `similar.colMedian` (one word, so the header never wraps at 390px; the unit is in the note); eight rows, then `similar.listAll`, which moves focus to the first new row (a 2px ink outline inside the row). `similar.listNote` states the sales it counts and the unit and, when the stored list is shorter than the count (200 at most are stored), `similar.listCapped`.

**Sharing.** The headline, the OG title and the stamp stay "Too few". The WhatsApp text adds `similar.share` after `share.textThin` (`{where}` is `similar.shareWhereOthers` with the same `{place}` as the sources line, or `similar.shareWhereOwn`). The link preview's description is `similar.ogDesc`; the image shows `similar.ogLine` at y 488 in the recent-sales line's place; the alt texts of the image and the card add `similar.ogAlt`. The card (section 8) draws, under the count sentence, `similar.cardLabel`, the range scale's card variant (16px marks, three rows) and one caption line (`similar.cardCaption`, or `similar.cardCaptionOwn`); the TOO FEW stamp stays and nothing on it is a percentage. A too-few card with no range lists the registered sales that were found (four at most: date, size, price, AED per sq ft) between hairlines, so its middle is evidence and not paper. The footer link is fitted, never cut: the full line at 30 or 26px, else `card.linkShort` at 30, 26 or 22px.

**The other pages.** /how-it-works has the section `#too-few` (`how.similarH`): `how.similarBody`, `how.similarTested` (`{held}` and `{heldLater}` from `src/lib/similar/backtest.json`; "6 to 8 of 10" is the measured 63.3% to 81.0% of really thin buildings) and `how.similarWeaker`. /coverage carries `similar.coverageNote` with the link `similar.coverageLink` to it (the inline link pattern, with a 44px hit area).

**The OG building line.** Satori measures a word one glyph at a time, without kerning, but draws the whole word with the font's kerning, so a word with strong pairs ("To", "Ay", "we") ended short of its measured box and the next word began too far right ("Aykon  City Tower  C"). The Newsreader lines of the image (the building and the verdict) are set one span per letter, with a 0.22em word space, so the drawing matches the measuring.

| Key | String |
|---|---|
| `similar.h` | A range from more registered sales |
| `similar.intro` | This building has too few registered sales of its own to compare, so Fairsquare looked at more registered sales. |
| `similar.range` | They point to a median between AED {low} and AED {high} per sq ft for {basis} {bedTypePlural} in {building}, in the {months} months to {to}. |
| `similar.within` | This asking price, AED {asking} per sq ft, is within that range. |
| `similar.above` | This asking price, AED {asking} per sq ft, is above that range. |
| `similar.below` | This asking price, AED {asking} per sq ft, is below that range. |
| `similar.headWithin` | Within the range |
| `similar.headAbove` | Above the range |
| `similar.headBelow` | Below the range |
| `similar.tierClose` | Narrow range |
| `similar.tierBroad` | Broad range |
| `similar.sources` | The range is built from {list}. |
| `similar.and` | and |
| `similar.srcOwn` | {n} registered sale in this building in those {months} months / {n} registered sales in this building in those {months} months |
| `similar.srcOlder` | {n} earlier sale of the same type here, back to {from} / {n} earlier sales of the same type here, back to {from} |
| `similar.srcOtherBeds` | {n} sale of other bedroom types here / {n} sales of other bedroom types here |
| `similar.srcRef` | {n} registered sales of {basis} {bedTypePlural} in {k} other building {place} / {n} registered sales of {basis} {bedTypePlural} in {k} other buildings {place} |
| `similar.placeProject` | of the same project |
| `similar.placeNamed` | in {place} |
| `similar.placeArea` | in the same area |
| `similar.srcSpan` | Their medians run from AED {lo} to AED {hi} per sq ft. |
| `similar.weaker` | Other buildings are not matched on size or price level, and are weaker evidence than sales in this one. Not a valuation. |
| `similar.weakerOwn` | A few sales are weaker evidence than {minSales} or more in {months} months. Not a valuation. |
| `similar.tested` | In tests on buildings with many registered sales, a range built this way held the building's own median in about {held} of 10 cases, and in about {heldLater} of 10 against the six months that followed. |
| `similar.limits` | The range takes no account of size, floor, view or condition. |
| `how.similarH` | When a building has too few sales |
| `how.similarBody` | With fewer than {minSales} registered sales of a type in {months} months, Fairsquare can show a range in place of a single figure. The range combines the few sales the building has, its earlier sales, its other bedroom types and the medians of other buildings in the same project, community or area. Those other buildings are not matched on size or price level. The range shows only for studios to 3-beds, only when the building has registered sales of its own and never from the few sales of those {months} months alone, only when the building's own sales agree with each other and sit inside the range, and only when the range is narrow enough to say something. A building that is not in DLD sales data gets a range of this kind only in the one case below. |
| `similar.scaleTitle` | Where this asking price sits against the range |
| `similar.scaleSummary` | A scale in AED per sq ft from {min} to {max}. The shaded range runs from AED {low} to AED {high}. The asking price, AED {asking}, is {position} it. |
| `similar.scaleOthers` | {k} other building is marked with a ring at the median of its registered sales. / {k} other buildings are marked with rings at the median of their registered sales, from AED {lo} to AED {hi}. |
| `similar.scaleOwn` | {n} registered sale in this building is marked with a filled dot. / {n} registered sales in this building are marked with filled dots. |
| `similar.asking` | Asking |
| `similar.endsJoined` | {low} to {high} |
| `similar.posWithin` | within |
| `similar.posAbove` | above |
| `similar.posBelow` | below |
| `similar.legendRange` | the range, AED {low} to {high} |
| `similar.legendOther` | another building, at its median |
| `similar.legendOtherK` | up to {k} other buildings |
| `similar.legendOwn` | a sale in this building |
| `similar.legendOff` | {n} more is off this scale. / {n} more are off this scale. |
| `similar.scaleCapped` | Only the {shown} with the most sales, of {k}, are on this scale. |
| `similar.readout` | {building}: {n} registered sale, median AED {psf} per sq ft. / {building}: {n} registered sales, median AED {psf} per sq ft. |
| `similar.readoutK` | {k} other buildings near AED {psf} per sq ft. |
| `similar.readoutOwn` | This building, {date}: {size} sq ft, AED {price}, AED {psf} per sq ft. |
| `similar.listShow` | See the other building / See the {k} other buildings |
| `similar.listHide` | Hide the list |
| `similar.listNote` | Registered sales of {basis} {bedTypePlural}, {from} to {to}. Medians in AED per sq ft. Most sales first. |
| `similar.listCapped` | The {shown} with the most sales, of {k}. |
| `similar.listAll` | Show all {n} |
| `similar.colBuilding` | Building |
| `similar.colSales` | Sales |
| `similar.colMedian` | Median |
| `similar.defClose` | Narrow range: its ends are within about 10% of its middle. |
| `similar.defBroad` | Broad range: its ends are up to about 20% from its middle. Fairsquare shows nothing wider. |
| `similar.share` | More registered sales, {where}, point to a median between AED {low} and AED {high} per sq ft; the asking price, AED {asking} per sq ft, is {position} that range. Weaker evidence than {minSales} or more sales in the tower. |
| `similar.shareWhereOthers` | in this tower and in other buildings {place} |
| `similar.shareWhereOwn` | in this tower over three years |
| `similar.ogDesc` | Too few sales in this building to compare. More registered sales point to a median between AED {low} and AED {high} per sq ft. Weaker evidence. Not a valuation. |
| `similar.ogLine` | A range from more registered sales: AED {low} to {high} per sq ft |
| `similar.ogAlt` | A range from more registered sales runs from AED {low} to AED {high} per sq ft; the asking price is {position} it. |
| `similar.cardLabel` | The range from more registered sales, AED per sq ft |
| `similar.cardCaption` | Rings: other buildings, at their median. Weaker evidence. |
| `similar.cardCaptionOwn` | Weaker evidence than {minSales} or more sales in {months} months. |
| `similar.coverageNote` | A building with too few sales can still get a range from more registered sales: its own earlier sales and other buildings of its project, community or area. An off-plan building that is not in the data can get a range from other buildings of its project. It is weaker evidence. |
| `similar.coverageLink` | How that works |
| `how.similarTested` | Fairsquare tested this on buildings with many registered sales, by hiding most of their sales and building the range from the rest. The range held the building's own median in about {held} of 10 cases. Against the median of the six months that followed it held in about {heldLater} of 10, because prices move. For buildings that really have few sales the tests are less exact, and it held in about 6 to 8 of 10. |
| `how.similarWeaker` | A range from more registered sales is weaker evidence than a same-building comparison. It takes no account of size, floor, view or condition. Not a valuation. |
| `similar.projectH` | A range from other buildings in the {project} project |
| `similar.projectIntro` | This building has no registered sales in the data, so Fairsquare looked at registered sales in other buildings in the {project} project. |
| `similar.projectRange` | They point to a median between AED {low} and AED {high} per sq ft for {basis} {bedTypePlural} in a new building of this project, from sales in the {months} months to {to}. |
| `similar.projectSrc` | The range is built from {n} registered sales of {basis} {bedTypePlural} in {k} other building in the {project} project. / The range is built from {n} registered sales of {basis} {bedTypePlural} in {k} other buildings in the {project} project. |
| `similar.projectWeaker` | The building itself has no registered sales in the data. Other buildings are not matched on size or price level, and are weaker evidence than sales in the building itself. Not a valuation. |
| `similar.projectTested` | In tests on buildings as they first appeared in the data, using only the sales registered before them, a range built this way held the median of their first six months of registered sales in about {held} of 10 cases. |
| `similar.projectReach` | New buildings of a project have sold above its other buildings more often than below, so the range reaches further above their median than below it. |
| `similar.projectShare` | Registered sales in other buildings in the {project} project point to a median between AED {low} and AED {high} per sq ft; the asking price, AED {asking} per sq ft, is {position} that range. The building itself has no registered sales in the data. Weaker evidence. Not a valuation. |
| `similar.projectOgDesc` | No registered sales for this building in the data. Other buildings in the {project} project point to a median between AED {low} and AED {high} per sq ft. Weaker evidence. Not a valuation. |
| `similar.projectOgLine` | Other buildings in the {project} project: AED {low} to {high} per sq ft |
| `similar.projectOgAlt` | A range from other buildings in the {project} project runs from AED {low} to AED {high} per sq ft; the asking price is {position} it. |
| `how.similarProject` | A building that is not in DLD sales data gets no range of this kind, with one exception. When an off-plan listing names a project Fairsquare can identify in the data, and other buildings of that project have registered sales of the same type, Fairsquare can show a range from those other buildings, for studios to 3-beds. The page says that the building itself has no registered sales in the data. An area or a community alone never gives a range of this kind, and a ready building never gets one this way. |
| `how.similarProjectTested` | Fairsquare tested this on buildings as they first appeared in DLD data, using only the sales registered before them. The range held the median of their first six months of sales in about {held} of 10 cases. It rests on few projects, so it is weaker evidence still. |

---

### 6.17 Adjusted registered sales (the first answer)

Added 19 Nov 2026 (REAL_DATA.md section 16). For a building in the data, studio to 3-bed, the comparison first looks at the building's registered sales of three years, each adjusted to the listing (its date, its size). When that gives a range (`shownAcs`, `src/lib/acs/shown.ts`), the range leads the result and decides above, within or below; the fixed {bandPct}% band is then not used. When it gives none, the result is what sections 6.14 to 6.16 describe, unchanged. These keys are the wording for that answer; the layout follows the rules below.

Rules of this section, on top of the rules of section 6:

- It must read as registered sales adjusted to this listing, never as a price Fairsquare states. The noun is "registered sales"; the verb is "adjusted" or "moved".
- The page lists every registered sale used and what was changed (`acs.listShow`, the `acs.col*` columns): the registered figure, the change for date, the change for size, the adjusted figure, how much it counts.
- A row can be one of three things the same-building list never had, each with its own words: a sale of another bedroom type in the building (`acs.rowOtherBeds`), a sale in another building of the project (`acs.rowProject`), and several apartments registered at one price per sq ft (`acs.rowBatch`) or with the same date, size and price (`acs.rowSame`).
- No single middle figure is shown or stored for a page: only the two ends of the range, each rounded to AED 10 per sq ft.
- `{held}` in `acs.tested` and `how.acsTested` comes from the result stored with the comparison (8 for the fit of 19 Nov 2026: the lowest of the tested shares, rounded down).
- `acs.medianLine` keeps the same-building median on the page beside the range, so a reader sees both.
- `{position}` is `acs.posWithin`, `acs.posAbove` or `acs.posBelow`. `acs.adjUp` and `acs.adjDown` take a percentage with one decimal; `acs.adjNone` is for a change that rounds to 0.0%. Plural forms are "singular / plural" (`tPlural`).

**Who leads (the interface, 19 Nov 2026).** `acsShown()` in `src/lib/copy.ts` says whether a stored comparison shows the range at all (a matched building, never "Not covered yet", and `shownAcs`); `acsLead()` says whether it leads. Everything that words or draws the range goes through one of the two, so a refusal, an entry of another version, `ACS_TIER=off` and a comparison stored before 19 Nov 2026 (no entry) leave every page, card, preview and share text exactly as sections 6.14 to 6.16 describe. Tests compare the markup.

**The building had its 5 or more sales: the range leads** (`src/components/check/result-view.tsx`, `src/components/result/acs-section.tsx`). Top to bottom:

- The headline (`VerdictWords` with the outcome): `acs.headWithin`, `acs.headAbove` or `acs.headBelow`, cut at `acs.headRest`. "Within the range" takes the in-line hue, "Above the range" and "Below the range" the above and below hues; "of adjusted sales" is ink. No percentage.
- The chart slot: the range scale with `source="acs"` in place of the market scale. No ASKING stamp, no 5% zone, no median fulcrum.
- `acs.intro` (`acs.introProject` when a sale of another building of the project is used) and `acs.range` as one paragraph in the Newsreader lead; the outcome (`acs.within`, `.above`, `.below`) in Archivo body 500.
- "Ask what explains the premium" when the outcome is above; the listing check when it is below (as for a verdict of the fixed band).
- The size note (`acs.sizeLarger`, `acs.sizeSmaller`), in the notice style, when the listing's size is more than 20% from the building's usual size for its bedroom count (`typicalSizeSqft`). It says the sales were adjusted for size and that this adjustment is less exact that far out. The older size note (`result.sizeLarger`) does not show beside it.
- `acs.medianLine` in Archivo 15/22 ink: the same-building median of the 12 months, with no adjustment. The recent-sales line does not show (the date adjustment covers it).
- When the asking price, in whole AED per sq ft, is past every adjusted sale used (and every row is listed), one more paragraph in Archivo body says so in figures: `acs.beyondHigh` or `acs.beyondLow`, whatever the outcome. When the outcome is still "within", `acs.beyondWithin` follows it and says why the range reaches further than the sales. Added 19 Nov 2026 after review: "within" must never hide that the asking price is above every sale on the page.
- `acs.leadOtherBeds`, in the notice style under the size note, when the stored evidence class says that sales of other bedroom types count for more than the building's own sales of the listing's type.
- The evidence line, Archivo 14/20 pencil: `acs.sources`, `acs.testedShort` ("about {held} of 10", from the stored result), `acs.dld` (the DLD building verbatim, so a wrong match shows), `acs.limits` (it ends "Not a valuation."). Under it, on a line of their own and 24px apart, `acs.howLabel` (underlined ink 500) and "Wrong building?": the two links never read as one underlined phrase and their 44px hit areas never meet. `acs.howLabel` opens the definitions (a Popover from 1024px named with `aria-label`, the info sheet on phones): `acs.howDate`, `acs.howSize`, `acs.howWeight`, `acs.tested`, `acs.limits`.
- Level 2: "The {n} registered sales used" (`acs.listH`, anchor `#sales-used`) in place of the 12-month sales list, then "Before you make an offer", the cost row, the provenance and the links as before. "How Fairsquare compares" says `acs.howShort`.

**The building has too few sales: its own section** (`AcsSection`). The headline, the tally, the too-few sentence, the DLD line, the TOO FEW stamp and the building's 12-month sales list stay exactly as they are. The section takes the second tier's place (one range on a page, never both; the second tier stays stored and shows when this answer does not): a hairline, the heading `acs.h` (h3; h2 on /c) in `type-title`, `acs.fewLead` (why there is no median and where the range comes from; `acs.fewLeadProject` when sales of other buildings of the project are used), the range scale, `acs.intro` and `acs.range` in Archivo body, the outcome in Archivo body 500, the size note, the evidence line (without `acs.dld`: the too-few line above names the building), `acs.leadOtherBeds` when it applies, and the list behind `acs.listShow`, closed until asked for. In this section the list is the stacked rows at every width: the section sits in the narrow column, where the table's eight columns do not fit. No headline of its own, no stamp, no verdict colour, no percentage.

**The range scale** is the second tier's (section 6.16: the same axis, zone with dashed ends, two end labels, indigo pin and diamond, the keyboard and the readout), drawn from `src/lib/result/acs-scale.ts`. The zone is the stored range for this listing's size at the data date. A filled ink dot is a registered sale of the listing's bedroom count in the building at its adjusted AED per sq ft (`acs.legendSale`); a hollow ring is a sale of another bedroom count in the building or one in another building of the project, adjusted (`acs.legendOther`). When a column would pass six marks one mark stands for up to `k` rows (`acs.legendSaleK`, `acs.readoutK`). A row adjusted to more than 1.6 times from the range's ends is not drawn and is counted (`similar.legendOff`). The group is named by `acs.scaleTitle` and described by `acs.scaleSummary`; a readout is `acs.readout` (`acs.readoutBeds` for another bedroom count), with `acs.rowOtherBeds` or `acs.rowProject` in front when the sale is not one of the type in the building. The readout's line keeps room for two lines (40px); a longer readout (another bedroom count, another building) takes a third.

**The sales used** (`AcsSalesList`). Three groups in this order, each under its own heading one level below the list's: `acs.groupOwn`, `acs.groupOtherBeds`, `acs.groupProject`. Inside a group the rows that count most are first (the stored order). No sort control. The first group shows 5 rows on phones and 8 from 1024px, the others 3 each; `acs.listAll` shows every row and moves focus to the first new one. `acs.listNote` is above the rows, with `acs.listCapped` when more than the 200 stored rows were used.

- Phones: stacked rows between hairlines, never a table and never wider than the column. Line 1: the registration date, and `acs.rowAdjusted` in ink 600 on the right. Line 2: `acs.rowRegistered` (the size and the registered AED per sq ft). Line 3 in pencil: `acs.colDateAdj`, `acs.colSizeAdj` and, for another bedroom count, `acs.colBedAdj`, each with `acs.adjUp`, `acs.adjDown` or `acs.adjNone`, then `acs.rowCounts`. Line 4 in pencil, when it applies: `acs.rowOtherBeds` or `acs.rowProject`, and `acs.rowBatch` or `acs.rowSame`.
- From 1024px: one table with a row group per origin and the columns `acs.colDate`, `acs.colSize`, `acs.colPsf`, `acs.colDateAdj`, `acs.colSizeAdj`, `acs.colBedAdj` (only when a sale of another bedroom count is used), `acs.colAdjusted` (ink 600) and `acs.colWeight` (a percentage of the whole). The origin and the several-sales note sit under the date.

**Sharing.**

- Leading: the stamp is `acs.stampWithin` (or `stamp.above`, `stamp.below`), `acs.stampFigure` ("1,550 TO 1,970", fitted like every figure), `acs.stampSales` ("AED PER SQ FT FROM 12 REGISTERED SALES": the unit and the noun, so the figures never stand alone) and "2-BED" with `acs.stampDate`; nothing on it is a percentage. The card shows `acs.cardRange` and `acs.cardRangeValue` in the median's place (fitted to the room left of the stamp, 80px down to 40px), then `acs.cardLabel`, the range scale's card variant and `acs.cardCaption` (`acs.cardCaptionK` when a dot stands for up to k rows, `acs.cardCaptionRows` when a row stands for several registered sales); its source line is `acs.cardSource` (`acs.cardSourceProject` when sales of other buildings of the project are used) with the dates of the earliest and latest sale used, as the page gives them, and the data date; its link `acs.cardLink`, its alt `acs.cardAlt`. The WhatsApp text is `acs.shareLead`, `acs.share` (`acs.shareProject` when sales of other buildings of the project are used) and `share.source`. The link preview: the title is `c.ogTitle` with the headline in lower case, the description `acs.ogDesc`, the image's lines `acs.ogFigures` at y 380 and `acs.ogLine` at y 488, its alt `acs.ogAlt`. The live region says `acs.announce`. The scene's right pan carries `acs.cardRangeValue` over `acs.sceneLabel`, and the beam is level inside the range.
- Too few with a range: the headline, the title and the stamp stay "Too few". The WhatsApp text adds `acs.share` after `share.textThin`; the description is `acs.ogDesc`; the image shows `acs.ogLine`; the alt texts add `acs.ogAlt`; the card draws `acs.cardLabel` and the scale in the second tier's place, and its source line and link are then the adjusted sales' (`acs.cardSource`, `acs.cardLink`), not the 12-month window's.
- /c mirrors the result as stored, without "Wrong building?". When the range leads there is no "Today" line (the range is a dated statement and is never recomputed). On /saved the line of such a comparison is `acs.saved`, with the position word in the outcome's hue, and no "Today" figure.

**The other pages.** /how-it-works has the section `#adjusted` (`how.acsH`) after `#too-few`, which `how.acsFallback` refers to: `how.acsBody`, `how.acsFallback`, `how.acsTested` (`{held}` from `src/lib/acs/constants.json`) and `how.acsLimits`. With `ACS_TIER=off`, or while the answer cannot run (no usable model, a fit or data that has aged out: `acsStatus`), the section and its entry in the table of contents are not rendered. /coverage is unchanged: its counts are the 12-month sales, which this answer does not change.

| Key | String |
|---|---|
| `acs.h` | Registered sales, adjusted to this listing |
| `acs.intro` | Fairsquare took {n} registered sales in {building} and adjusted each one to this listing: to {to} for its date and to {size} sq ft for its size. |
| `acs.introProject` | Fairsquare took {n} registered sales in {building} and in other buildings of its project, and adjusted each one to this listing: to {to} for its date and to {size} sq ft for its size. |
| `acs.range` | Adjusted this way, they point to a range of AED {low} to AED {high} per sq ft. |
| `acs.within` | This asking price, AED {asking} per sq ft, is within that range. |
| `acs.above` | This asking price, AED {asking} per sq ft, is above that range. |
| `acs.below` | This asking price, AED {asking} per sq ft, is below that range. |
| `acs.beyondHigh` | It is higher than all {n} adjusted sales; the highest is AED {psf} per sq ft. |
| `acs.beyondLow` | It is lower than all {n} adjusted sales; the lowest is AED {psf} per sq ft. |
| `acs.beyondWithin` | The range reaches further than the adjusted sales themselves because, in tests, later sale prices spread further than the sales before them. |
| `acs.headWithin` | Within the range of adjusted sales |
| `acs.headAbove` | Above the range of adjusted sales |
| `acs.headBelow` | Below the range of adjusted sales |
| `acs.posWithin` | within |
| `acs.posAbove` | above |
| `acs.posBelow` | below |
| `acs.sources` | The range is built from {list}, registered from {from} to {to}. |
| `acs.and` | and |
| `acs.srcOwn` | {n} sale of {bedTypePlural} in this building / {n} sales of {bedTypePlural} in this building |
| `acs.srcOtherBeds` | {n} sale of another bedroom type in this building / {n} sales of other bedroom types in this building |
| `acs.srcProject` | {n} sale in another building of the project / {n} sales in other buildings of the project |
| `acs.medianLine` | With no adjustment, the median of the {count} sales of the last {months} months is AED {median} per sq ft. |
| `acs.tested` | Fairsquare tested this on four past data dates. It built the range from the sales registered before each date, then looked at apartments sold in the six months after. About {held} of 10 of those later sale prices were inside the range. |
| `acs.limits` | The adjustments are for date, size and, for a sale of another bedroom type, bedrooms. Floor, view and condition are not in DLD sales data. Not a valuation. |
| `acs.howDate` | Date: each sale is moved to {to} with the movement of registered sale prices in its area since its month. |
| `acs.howSize` | Size: each sale is moved to {size} sq ft with the relation between size and AED per sq ft. For a sale of the same bedroom type in this building, that relation comes from this building's sales together with Dubai's registered sales of that type. For a sale of another bedroom type or in another building, it comes from Dubai's registered sales, and a sale of another bedroom type is also moved by the usual step between bedroom types. |
| `acs.howWeight` | How much a sale counts: recent sales and sales close in size count more. Sales of another bedroom type or in another building of the project count less. |
| `acs.listShow` | See the registered sale used / See the {n} registered sales used |
| `acs.listHide` | Hide the list |
| `acs.listNote` | Each row is a registered sale and what Fairsquare changed to compare it with this listing. The rows that count most are first. |
| `acs.listCapped` | The {shown} rows that count most, of {n}. |
| `acs.colDate` | Registered |
| `acs.colSize` | Size |
| `acs.colPsf` | AED per sq ft |
| `acs.colDateAdj` | For date |
| `acs.colSizeAdj` | For size |
| `acs.colBedAdj` | For bedrooms |
| `acs.colAdjusted` | Adjusted |
| `acs.colWeight` | Counts for |
| `acs.adjUp` | up {pct}% |
| `acs.adjDown` | down {pct}% |
| `acs.adjNone` | no change |
| `acs.rowOtherBeds` | {bedType} in this building |
| `acs.rowProject` | {building}, same project |
| `acs.rowBatch` | {n} apartments registered at one price per sq ft. The size is their median. |
| `acs.rowSame` | {n} sales registered with the same date, size and price. |
| `acs.readout` | {date}: {size} sq ft at AED {psf} per sq ft. Adjusted for date and size: AED {adjusted} per sq ft. |
| `acs.scaleTitle` | Where this asking price sits against the range of adjusted sales |
| `acs.scaleSummary` | The range runs from AED {low} to AED {high} per sq ft. The asking price, AED {asking} per sq ft, is {position} it. {n} adjusted registered sales are marked. |
| `acs.legendRange` | the range, AED {low} to {high} |
| `acs.legendSale` | a registered sale, adjusted |
| `acs.share` | Registered sales in this building, each adjusted to this listing, point to AED {low} to AED {high} per sq ft. The asking price, AED {asking} per sq ft, is {position} that range. Not a valuation. |
| `acs.shareProject` | Registered sales in this building and in other buildings of its project, each adjusted to this listing, point to AED {low} to AED {high} per sq ft. The asking price, AED {asking} per sq ft, is {position} that range. Not a valuation. |
| `acs.ogDesc` | {n} registered sales, each adjusted to this listing, point to AED {low} to AED {high} per sq ft. The asking price is {position} that range. Not a valuation. |
| `acs.ogLine` | Registered sales, adjusted to this listing: AED {low} to {high} per sq ft |
| `acs.ogAlt` | A range from registered sales adjusted to this listing runs from AED {low} to AED {high} per sq ft; the asking price is {position} it. |
| `acs.cardLabel` | Registered sales adjusted to this listing, AED per sq ft |
| `acs.headRest` | of adjusted sales |
| `acs.fewLead` | A median needs {minSales} sales in {months} months, so there is none here. The range below comes from this building's registered sales of three years, each adjusted to this listing. |
| `acs.fewLeadProject` | A median needs {minSales} sales in {months} months, so there is none here. The range below comes from three years of registered sales in this building and in other buildings of its project, each adjusted to this listing. |
| `acs.sizeLarger` | This listing is {pct}% larger than the usual {bedType} sold in this building, {typical} sq ft. Each sale was adjusted for size; that adjustment is less exact this far from the usual size. |
| `acs.sizeSmaller` | This listing is {pct}% smaller than the usual {bedType} sold in this building, {typical} sq ft. Each sale was adjusted for size; that adjustment is less exact this far from the usual size. |
| `acs.leadOtherBeds` | Sales of other bedroom types in this building count for more of this range than its sales of {bedTypePlural}. Each of them was also adjusted for bedrooms. |
| `acs.testedShort` | In tests, about {held} of 10 later sale prices were inside a range made this way. |
| `acs.dld` | DLD building: {dld}. |
| `acs.howLabel` | How the sales were adjusted |
| `acs.howShort` | Fairsquare adjusts each registered sale to the data date and to the listing's size, and shows the range they point to. The asking price is above, within or below that range. |
| `acs.listH` | The registered sale used / The {n} registered sales used |
| `acs.groupOwn` | This building, {bedTypePlural} |
| `acs.groupOtherBeds` | This building, other bedroom types |
| `acs.groupProject` | Other buildings of the project |
| `acs.listAll` | Show all {n} rows |
| `acs.rowRegistered` | {size} sq ft at AED {psf} per sq ft |
| `acs.rowAdjusted` | Adjusted: AED {psf} |
| `acs.rowCounts` | Counts for {pct}% |
| `acs.legendOther` | another bedroom type or building, adjusted |
| `acs.legendSaleK` | up to {k} registered sales, adjusted |
| `acs.readoutK` | {k} adjusted sales near AED {psf} per sq ft. |
| `acs.readoutBeds` | {date}: {size} sq ft at AED {psf} per sq ft. Adjusted for date, size and bedrooms: AED {adjusted} per sq ft. |
| `acs.cardRange` | Adjusted sales, per sq ft |
| `acs.cardRangeValue` | AED {low} to {high} |
| `acs.cardCaption` | Each dot is one registered sale, adjusted to this listing. |
| `acs.cardCaptionK` | Each dot is up to {k} registered sales, adjusted to this listing. |
| `acs.cardCaptionRows` | Each dot is one or more registered sales, adjusted. |
| `acs.cardSource` | Registered sales, {from} to {to}, each adjusted to {date}. DLD open data via Data.Dubai. Not a valuation. Fairsquare is independent of DLD. |
| `acs.cardSourceProject` | Registered sales in this building and its project, {from} to {to}, each adjusted to {date}. DLD open data via Data.Dubai. Not a valuation. Fairsquare is independent of DLD. |
| `acs.cardLink` | See the {n} sales used: {host}/c/{code} |
| `acs.cardAlt` | Fairsquare comparison card. {building}, {listingType}, {size} sq ft, asking AED {total}. {verdict}. Asking AED {asking} per sq ft; {n} registered sales, each adjusted to this listing, point to AED {low} to AED {high} per sq ft. Not a valuation. |
| `acs.stampWithin` | WITHIN |
| `acs.stampFigure` | {low} TO {high} |
| `acs.stampSales` | AED PER SQ FT FROM {n} REGISTERED SALES |
| `acs.stampDate` | ADJUSTED TO {date} |
| `acs.ogFigures` | Asking AED {asking} per sq ft, {n} registered sales adjusted |
| `acs.shareLead` | {building}, {listingType}, {size} sq ft, asking AED {total} (AED {asking} per sq ft). |
| `acs.announce` | {verdict}. {building}, {listingType}, AED {asking} per sq ft. {n} registered sales, each adjusted to this listing, point to AED {low} to AED {high} per sq ft. |
| `acs.sceneLabel` | range of {n} adjusted sales |
| `acs.saved` | Saved {date}: {position} the range of adjusted sales. |
| `how.acsH` | How registered sales are adjusted to a listing |
| `how.acsBody` | For a building in DLD sales data, Fairsquare first looks at its registered sales of the last three years: sales of the same bedroom type, sales of other bedroom types in the building, and sales of the same bedroom type in other buildings of its project. It moves each sale to the data date with the movement of registered sale prices in its area, and to the listing's size with the relation between size and AED per sq ft. For a sale of the same bedroom type in the building, that relation comes from the building's own sales together with Dubai's registered sales of that type; for the other sales it comes from Dubai's registered sales, and a sale of another bedroom type is also moved by the usual step between bedroom types. Recent sales and sales close in size count more. The result is a range, and the asking price is above, within or below it. |
| `how.acsFallback` | Fairsquare shows this range only for studios to 3-beds, only when the building has registered sales of the same bedroom type, only when the listing's size is close to the sizes sold, and only when the range is narrow enough to say something. In every other case it compares as described above: with the median of the building's sales, or with a range from more registered sales when there are too few. |
| `how.acsTested` | Fairsquare tested this on four past data dates. It built the range from the sales registered before each date, then looked at apartments sold in the six months after. About {held} of 10 of those later sale prices were inside the range. After prices fall, more of the later sales are under the range than over it. |
| `how.acsLimits` | The adjustments are for date, size and, for a sale of another bedroom type, bedrooms. Floor, view and condition are not in DLD sales data, so two apartments of one size in one building get the same range. Not a valuation. |

### 6.18 Nearby registered sales (the last resort)

Added 20 Nov 2026 (REAL_DATA.md section 17). Owner decision: when a listing's building has no usable registered sales ("Too few sales to compare yet") or is not in the data ("Not covered yet"), the page still compares, with registered sales in other buildings nearby, and gives a result. It is the last resort: it is computed only when the same-building comparison, adjusted registered sales (section 6.17) and the second tier (section 6.16) all give nothing to show, and `nearbyShown()` in `src/lib/copy.ts` shows it only then. Everything that words or draws it goes through `nearbyShown()`, so a refusal, `NEARBY_TIER=off`, withdrawn constants and a comparison stored before 20 Nov 2026 leave every page exactly as it was.

Two kinds. "in": a building was chosen and is in the data; the other buildings are those of its community (master project), with the rest of its DLD area when the community has fewer than three. "out": no building was chosen; the listing's area text is resolved to a community or a DLD area, and when it names none the page stays "Not covered yet".

Rules of this section, on top of the rules of section 6:

- The headline gives the result: `nearby.headWithin`, `nearby.headAbove` or `nearby.headBelow`, cut at `nearby.headRest` ("Above the range" in the outcome's hue, "of nearby sales" in ink). It replaces "Too few sales to compare yet" and "Not covered yet". No percentage.
- Directly under the headline and the fact line, above the scale, `NearbyOwnNote` says two things in plain words, with a 2px ink rule on its left: what the building itself has (`nearby.ownNone`, `nearby.ownFew`, or `nearby.ownOut` for a building that was not found), and in Archivo 500 that the range comes from other buildings in a named place (`nearby.fromOthers`; `{place}` is the community, `nearby.placeBoth`, or the area).
- The range is in AED per sq ft on the range scale (`source="nearby"`, `src/lib/result/nearby-scale.ts`) with the asking price as the pin. Every mark is a hollow ring: a registered sale in another building at its adjusted figure (on every range scale a ring is another building). There is no filled dot, no middle mark, no single figure and no percentage difference.
- `nearby.intro` (`nearby.introAge` when the sales were also adjusted for the age of their building) and `nearby.range` as one paragraph in the Newsreader lead; the outcome (`nearby.within`, `.above`, `.below`) in Archivo body 500.
- The weakness note (`NearbyWeakNote`, the notice style) is always on the page: `nearby.weak`, then `nearby.tested` (`{held}` is `tested.heldOf10` of the constants stored with the comparison, 7 for the fit of 16 Nov 2026; never a number written in the copy), then for a building that was not found `nearby.weakOut`.
- The evidence line, Archivo 14/20 pencil: `nearby.dld` (the DLD building verbatim, kind "in" only) and `nearby.notValuation`. Under it, 24px apart, `nearby.howLabel` (a Popover from 1024px, a sheet on phones: `nearby.howDate`, `nearby.howSize`, one of `nearby.howAge`, `nearby.howAgeNew`, `nearby.howAgeNone`, `nearby.howWeight`, `nearby.howArea` when the rest of the area is read, `nearby.howOwn` for a building in the data, `nearby.tested`, `nearby.limits`) and the way to another building: "Wrong building?" (`evidence.wrongBuilding`) for a chosen building, `nearby.pick` for one that was not found. Both open the building question of the Change a detail sheet.
- "The sales used" (`NearbySalesList`, anchor `#nearby-sales-used`, open, never behind an ask): the heading `nearby.listH`; then `nearby.buildingsH` with a table of the buildings (`nearby.colBuilding`, `nearby.colSales`, `nearby.colWeight`: each building's share of the whole, the building that counts most first, 6 rows until `nearby.buildingsAll`); then `nearby.rowsH` with every sale. From 1024px one table: the building, `nearby.colDate`, `nearby.colSize`, `nearby.colPsf`, `nearby.colDateAdj`, `nearby.colSizeAdj`, `nearby.colAgeAdj` (only when that adjustment is made), `nearby.colAdjusted` (ink 600) and `nearby.colWeight`. On phones stacked rows: the building and `nearby.rowAdjusted`, then `nearby.rowRegistered`, then the adjustments and `nearby.rowCounts` in pencil. The rows that count most are first; 5 rows on phones and 8 from 1024px until `nearby.listAll`. At most 200 rows and 200 buildings are stored (`nearby.listCapped`, `nearby.buildingsCapped`).
- A building with too few sales keeps its own registered sales listed under the sales used: they are facts, though too few to compare.
- The result takes the actions of a verdict: Send on WhatsApp, Save and track, More ways to share, and the card preview from 1024px. A building that was not found no longer shows "Search covered buildings" and "Request it and track" on this page; `nearby.pick` leads to the building question instead.
- "Not a valuation" as elsewhere. No word of section 6's forbidden list; "nearby", never the word the second tier's internal name uses.

**Sharing.** The stamp claims no more than nearby registered sales: `nearby.stampWithin` (or `stamp.above`, `stamp.below`), `nearby.stampFigure` ("990 TO 1,770"), `nearby.stampSales` and "2-BED" with `nearby.stampDate`. The card (a not-covered comparison gets one when this range shows): the headline in two lines, the asking figure, `nearby.cardRange` with `nearby.cardRangeValue`, the stamp, one sentence in Archivo 500 28 ink (`nearby.cardNoteIn` or `nearby.cardNoteOut`: other buildings, the place, and what this building has), the scale of rings, `nearby.cardCaption` (`nearby.cardCaptionK` when a ring stands for several; dropped when the room is short), the source `nearby.cardSource` and `nearby.cardLink`; its alt is `nearby.cardAlt`. The link preview: the title is `c.ogTitle` with the headline in lower case, the description `nearby.ogDescIn` or `nearby.ogDescOut`, the image lines `nearby.ogFigures` and `nearby.ogLine`, the alt `nearby.ogAlt`. WhatsApp: `nearby.shareLead`, then `nearby.shareIn` or `nearby.shareOut`, then `share.source`. Saved: `nearby.saved`, the position word in the outcome's hue. The scene's right pan: the range with `nearby.sceneLabel`. "How Fairsquare compares" says `nearby.howShort`.

**The other pages.** /how-it-works has the section `#nearby` (`how.nearbyH`) after the adjusted-sales section, only while this answer can run: `how.nearbyBody`, `how.nearbyOut`, `how.nearbyFallback`, `how.nearbyTested` (`{held}` from `src/lib/nearby/constants.json`) and `how.nearbyWeak`. /coverage adds `nearby.coverageNote` with a link to that section while `NEARBY_TIER` is on. The second tier's sentences about a building that is not in the data now say "a range of this kind" (`how.similarBody`, `how.similarProject`), because this section gives such a building a comparison of another kind.

| Key | String |
|---|---|
| `nearby.headWithin` | Within the range of nearby sales |
| `nearby.headAbove` | Above the range of nearby sales |
| `nearby.headBelow` | Below the range of nearby sales |
| `nearby.headRest` | of nearby sales |
| `nearby.posWithin` | within |
| `nearby.posAbove` | above |
| `nearby.posBelow` | below |
| `nearby.ownNone` | {building} has no registered sales of {basis} {bedTypePlural} in the {months} months to {to}. |
| `nearby.ownFew` | {building} has {count} registered sale of {basis} {bedTypePlural} in the {months} months to {to}. A comparison needs {minSales}. / {building} has {count} registered sales of {basis} {bedTypePlural} in the {months} months to {to}. A comparison needs {minSales}. |
| `nearby.ownOut` | Fairsquare could not find “{building}” in Dubai Land Department sales data, so there are no registered sales of this building to compare. |
| `nearby.fromOthers` | The range here comes from other buildings in {place}, not from this one. |
| `nearby.placeBoth` | {community} and the rest of {area} |
| `nearby.intro` | Fairsquare took {n} registered sales of {basis} {bedTypePlural} in {k} other buildings in {place} and adjusted each one to this listing: to {to} for its date and to {size} sq ft for its size. |
| `nearby.introAge` | Fairsquare took {n} registered sales of {basis} {bedTypePlural} in {k} other buildings in {place} and adjusted each one to this listing: to {to} for its date, to {size} sq ft for its size, and for the age of its building. |
| `nearby.range` | Adjusted this way, they point to a range of AED {low} to AED {high} per sq ft. |
| `nearby.within` | This asking price, AED {asking} per sq ft, is within that range. |
| `nearby.above` | This asking price, AED {asking} per sq ft, is above that range. |
| `nearby.below` | This asking price, AED {asking} per sq ft, is below that range. |
| `nearby.weak` | These sales are in other buildings. A building priced above or below its neighbours, for its brand, quality, view or age, will read above or below this range. |
| `nearby.tested` | In tests, about {held} of 10 later sale prices were inside a range made this way. |
| `nearby.weakOut` | Fairsquare could not find this building in DLD sales data. Its name may be registered differently. |
| `nearby.pick` | Find the building in DLD data |
| `nearby.dld` | DLD building: {dld}. |
| `nearby.notValuation` | Not a valuation. |
| `nearby.howLabel` | How the sales were adjusted |
| `nearby.howDate` | Date: each sale is moved to {to} with the movement of registered sale prices in its area since its month. |
| `nearby.howSize` | Size: each sale is moved to {size} sq ft with the relation between size and AED per sq ft in Dubai's registered sales of that bedroom type. |
| `nearby.howAge` | Building age: newer buildings register higher prices per sq ft. Each sale is moved from the age of its building to the age of this one, and buildings close to it in age count more. |
| `nearby.howAgeNew` | Building age: newer buildings register higher prices per sq ft. This building is not in the data, so each sale is moved from the age of its building to a newly launched one. |
| `nearby.howAgeNone` | Building age: not adjusted, because this building is not in the data and its age is not known. |
| `nearby.howWeight` | How much a sale counts: recent sales and sales close in size count more. A building with many sales counts no more than one building's full share. |
| `nearby.howArea` | Buildings outside {community} count less than buildings in it. |
| `nearby.howOwn` | This building's own registered sales are not part of the range. |
| `nearby.limits` | Floor, view, condition and what sets one building apart from the next are not in the adjustments. Not a valuation. |
| `nearby.howShort` | This building has no usable registered sales of its own. Fairsquare adjusts registered sales in other buildings nearby to the data date and to the listing's size, and shows the range they point to. The asking price is above, within or below that range. |
| `nearby.listH` | The registered sale used / The {n} registered sales used |
| `nearby.listNote` | Each row is a registered sale in another building and what Fairsquare changed to compare it with this listing. The rows that count most are first. |
| `nearby.listCapped` | The {shown} rows that count most, of {n}. |
| `nearby.listAll` | Show all {n} rows |
| `nearby.buildingsH` | The building they are in / The {k} buildings they are in |
| `nearby.buildingsNote` | How much each building counts in the range. The building that counts most is first. |
| `nearby.buildingsCapped` | The {shown} buildings that count most, of {k}. |
| `nearby.buildingsAll` | Show all {k} buildings |
| `nearby.rowsH` | Each sale and its adjustments |
| `nearby.colBuilding` | Building |
| `nearby.colSales` | Sales |
| `nearby.colDate` | Registered |
| `nearby.colSize` | Size |
| `nearby.colPsf` | AED per sq ft |
| `nearby.colDateAdj` | For date |
| `nearby.colSizeAdj` | For size |
| `nearby.colAgeAdj` | For building age |
| `nearby.colAdjusted` | Adjusted |
| `nearby.colWeight` | Counts for |
| `nearby.rowRegistered` | {date}: {size} sq ft at AED {psf} per sq ft |
| `nearby.rowAdjusted` | Adjusted: AED {psf} |
| `nearby.rowCounts` | Counts for {pct}% |
| `nearby.scaleTitle` | Where this asking price sits against the range of nearby sales |
| `nearby.scaleSummary` | The range runs from AED {low} to AED {high} per sq ft. The asking price, AED {asking} per sq ft, is {position} it. {n} adjusted registered sales in other buildings are marked. |
| `nearby.legendRange` | the range, AED {low} to {high} |
| `nearby.legendSale` | a registered sale in another building, adjusted |
| `nearby.legendSaleK` | up to {k} registered sales in other buildings, adjusted |
| `nearby.readout` | {building}, {date}: {size} sq ft at AED {psf} per sq ft. Adjusted: AED {adjusted} per sq ft. |
| `nearby.readoutK` | {k} adjusted sales near AED {psf} per sq ft. |
| `nearby.shareLead` | {building}, {listingType}, {size} sq ft, asking AED {total} (AED {asking} per sq ft). |
| `nearby.shareIn` | This building has too few registered sales of its own to compare. {n} registered sales in other buildings in {place}, each adjusted to this listing, point to AED {low} to AED {high} per sq ft. The asking price, AED {asking} per sq ft, is {position} that range. Other buildings are weaker evidence than sales in this one. |
| `nearby.shareOut` | Fairsquare could not find this building in DLD sales data. {n} registered sales in other buildings in {place}, each adjusted to this listing, point to AED {low} to AED {high} per sq ft. The asking price, AED {asking} per sq ft, is {position} that range. Other buildings are weaker evidence than sales in this one. |
| `nearby.ogDescIn` | Too few registered sales in this building to compare. {n} registered sales in other buildings in {place} point to AED {low} to AED {high} per sq ft. The asking price is {position} that range. Not a valuation. |
| `nearby.ogDescOut` | This building is not in DLD sales data. {n} registered sales in other buildings in {place} point to AED {low} to AED {high} per sq ft. The asking price is {position} that range. Not a valuation. |
| `nearby.ogLine` | Other buildings nearby: AED {low} to {high} per sq ft |
| `nearby.ogFigures` | Asking AED {asking} per sq ft, {n} registered sales in other buildings |
| `nearby.ogAlt` | A range from registered sales in other buildings in {place} runs from AED {low} to AED {high} per sq ft; the asking price is {position} it. |
| `nearby.cardRange` | Nearby sales, per sq ft |
| `nearby.cardRangeValue` | AED {low} to {high} |
| `nearby.cardNoteIn` | From other buildings in {place}. This building has too few registered sales of its own. |
| `nearby.cardNoteOut` | From other buildings in {place}. This building is not in DLD sales data. |
| `nearby.cardLabel` | Registered sales in other buildings, adjusted, AED per sq ft |
| `nearby.cardCaption` | Each ring is one registered sale in another building, adjusted. |
| `nearby.cardCaptionK` | Each ring is up to {k} registered sales in other buildings, adjusted. |
| `nearby.cardSource` | Registered sales in other buildings in {place}, {from} to {to}, each adjusted to {date}. DLD open data via Data.Dubai. Not a valuation. Fairsquare is independent of DLD. |
| `nearby.cardLink` | See the {n} sales used: {host}/c/{code} |
| `nearby.cardAlt` | Fairsquare comparison card. {building}, {listingType}, {size} sq ft, asking AED {total}. {verdict}. Asking AED {asking} per sq ft; {n} registered sales in other buildings in {place}, each adjusted to this listing, point to AED {low} to AED {high} per sq ft. Not a valuation. |
| `nearby.stampWithin` | WITHIN |
| `nearby.stampFigure` | {low} TO {high} |
| `nearby.stampSales` | AED PER SQ FT, NEARBY REGISTERED SALES |
| `nearby.stampDate` | ADJUSTED TO {date} |
| `nearby.sceneLabel` | range of {n} nearby sales |
| `nearby.saved` | Saved {date}: {position} the range of nearby sales. |
| `nearby.coverageNote` | A building with no usable registered sales, or one that is not in the data, can still be compared with registered sales in other buildings nearby. The page names where they are and says that they are other buildings. It is weaker evidence. |
| `how.nearbyH` | When the building itself gives nothing to compare |
| `how.nearbyBody` | When none of the comparisons above can be made, because the building has too few registered sales or is not in DLD sales data, Fairsquare compares with registered sales nearby. It takes sales of the same bedroom type in other buildings of the same community over two years. When the community has fewer than three such buildings, it adds the rest of the DLD area and counts those less. It moves each sale to the data date, to the listing's size and, where it applies, to the age of the building. Recent sales and sales close in size count more, and a building with many sales counts no more than one building's full share. The result is a range, and the asking price is above, within or below it. The page says that the range comes from other buildings and names where they are. The building's own sales are never part of it. |
| `how.nearbyOut` | For a building that is not in the data, Fairsquare reads the area the listing gives. When that names no place Fairsquare can identify, there is no comparison. The building may also be in the data under another name: the page offers to find it. |
| `how.nearbyFallback` | Fairsquare shows this range only for studios to 3-beds, only with sales in at least three other buildings, only when the listing's size is close to the sizes sold, and only when the range is narrow enough to say something. |
| `how.nearbyTested` | Fairsquare tested this on four past data dates. It built the range from the sales registered before each date, then looked at apartments sold in the six months after. About {held} of 10 of those later sale prices were inside the range. |
| `how.nearbyWeak` | This is the weakest comparison Fairsquare makes. The sales are in other buildings. A building priced above or below its neighbours, for its brand, quality, view or age, will read above or below the range. For a ready apartment in a new building that is not yet in the data, only about half of the later sale prices were inside the range at the latest test date. Not a valuation. |

## 7. Accessibility checklist and review-finding resolutions

### 7.1 Checklist the build must pass

Target: WCAG 2.2 AA, plus the ui-ux-pro-max quick-reference priorities 1 to 9 and the pro-rules pre-delivery checklist. Each item names how it is verified: **A** automated (axe-core in Playwright on every route, light and dark, at 360, 390, 768 and 1280px), **K** keyboard script in Playwright, **M** manual (VoiceOver on iOS Safari, TalkBack on Android Chrome, NVDA on Windows).

**Perceivable**

- [ ] Text contrast 4.5:1 and control boundaries, focus rings and meaningful marks 3:1, in both themes (`color-contrast`, `color-accessible-pairs`, `color-dark-mode`). A, plus the table in 2.1.
- [ ] Colour never carries meaning alone: the band has an icon and text; "This listing" has a shape and a label; coverage status has text (`color-not-only`, `pattern-texture`). M.
- [ ] Every meaningful image has alt text: the stamped sheet, the example, the plate. Decorative icons beside text are `aria-hidden` (`alt-text`, `icon-context`). A.
- [ ] No DOM text under 14px; body and inputs at 16px on phones (`readable-font-size`). A (custom rule on computed font size).
- [ ] Layout works at 200% zoom and at the largest iOS text size, without horizontal scroll (`dynamic-type`, `horizontal-scroll`). M.
- [ ] Viewport meta allows zoom: no `maximum-scale`, no `user-scalable=no` (`viewport-meta`). A.
- [ ] Headings in order, one h1 per page (`heading-hierarchy`). A.
- [ ] The chart has a visible text summary and a full list or table (`data-table`, `screen-reader-summary`). M.

**Operable**

- [ ] The full flow works by keyboard alone: choose file, read, edit, pick building, compare, share fallback, save, cost, consent, send, withdraw, delete all (`keyboard-nav`). K.
- [ ] Visible focus on every control: 2px `--ring` outline with 2px offset (`focus-states`). A plus M.
- [ ] Sticky header and action bar never cover the focused control: `scroll-padding-top` and `scroll-padding-bottom` set (`focus-not-obscured`). K (assert the focused element's rect is inside the unobscured area).
- [ ] Targets at least 44 by 44px with 8px gaps on touch; nothing below 24px anywhere (`touch-target-size`, `touch-spacing`, `web-target-size`). A (custom rule) plus M.
- [ ] Every drag has a button alternative: sliders have minus and plus buttons, drop has the Choose button (`dragging-alternative`). M.
- [ ] Skip link to `#main` (`skip-links`). K.
- [ ] Nothing moves without the user, except the stamp landing (under 400ms, once) and the reading border-beam (stops when reading ends). Reduced motion removes both (`reduced-motion`, `excessive-motion`). M with the OS setting.
- [ ] No auto-scroll on load; scroll only after an action, reduced-motion aware (`content-priority`, `back-stack-integrity`). K.
- [ ] Back works at every step through the URL (`back-behavior`, `deep-linking`, `state-preservation`). K.
- [ ] Toasts never steal focus and never carry the only copy of information (`toast-accessibility`). M.
- [ ] Admin login allows paste and password managers (`accessible-authentication`). K.

**Understandable**

- [ ] Every input has a visible label; helper text is persistent, not placeholder-only (`input-labels`, `input-helper-text`). A.
- [ ] Errors appear after blur or submit, under the field, tied with `aria-describedby` and `aria-invalid`, stating cause and fix (`inline-validation`, `error-placement`, `error-clarity`). K.
- [ ] Failed submit focuses the first invalid field, or the linked summary when there are 2 or more errors (`focus-management`, `error-summary`). K.
- [ ] Every error offers a recovery action (`error-recovery`, `timeout-feedback`). M.
- [ ] Selecting a radio never navigates or submits (WCAG 3.2.2). K.
- [ ] Help ("How Fairsquare compares") sits in the same place on every result and /c page (`consistent-help`). M.
- [ ] Values already given are not asked again (the building typed in step 2 pre-fills the request) (`redundant-entry`). M.
- [ ] Destructive actions confirm first and are visually separated (`confirmation-dialogs`, `destructive-emphasis`); removal of a saved item can be undone (`undo-support`). K.
- [ ] Multi-step flow shows "Step x of 3" and offers Back (`multi-step-progress`, `escape-routes`). A.

**Robust**

- [ ] Native semantics first: `<form>` with `type="submit"` on every input group, so Enter and the phone's Go key submit; `enterKeyHint` set ("go" on compare, "send" on lead and request). K.
- [ ] Live regions mounted once in the layout: reading status, building match count, verdict, cost output and save confirmations are announced (`aria-live-errors`, `contextual-live-badge-updates`). M.
- [ ] Focus moves on route change to the page h1 (`focus-on-route-change`). K.
- [ ] Dialogs, drawers and sheets trap focus, close on Esc and return focus to the trigger (`modal-escape`). K.
- [ ] Icon-only buttons have accessible names and expose state (`aria-labels`). A.
- [ ] Safe areas respected for the header and action bar (`safe-area-awareness`, `fixed-element-offset`). M on a notched phone.

### 7.2 Focus plan

| Event | Focus goes to | Announced (polite unless noted) |
|---|---|---|
| Client route change | Page h1 (`tabIndex={-1}`) | Next.js route announcer |
| Screenshot chosen | Step 2 h2 "Check the details" | "Reading your screenshot" |
| Reading done | Stays on h2 | "Read. Check the details." |
| Reading failed | The failure Alert's heading | Alert content (assertive, `role="alert"`) |
| Building matches change | Stays in the input | "3 matching buildings" |
| Compare with errors | First invalid field, or the error summary when there are 2 or more | Summary (assertive) |
| Compare done | Result h2 "Compared with 11 registered sales" | The verdict sentence |
| Drawer, sheet or dialog opens | First focusable inside (Radix) | Title |
| Drawer, sheet or dialog closes | The trigger | |
| Lead sent | Success Alert heading | "Sent to {partner}" |
| Saved item removed | The inline Undo button | "Removed {building}." |
| Delete all confirmed | Saved h1 | "Your data is deleted." |
| Back from step 3 | Step 2 h2, values kept | |

### 7.3 Review findings and how each is resolved

IDs: **A** = a11y-interaction reviewer (A1 to A25 in their order), **V** = visual-copy reviewer (V1 to V23), **P** = product-flow reviewer (P1 to P22). Every ID appears once or more below.

| Finding(s) | Resolution | Where |
|---|---|---|
| A1 Empty Bedrooms passes validation, "null-bed" on the card | One Zod schema shared by form and route; bedrooms an int 0 to 7, not nullable; the route returns 422; null fields show "Not in the screenshot. Choose one."; unit tests for null, undefined, empty string and NaN. | 3.3 |
| A2, P14 Silent core flow for screen readers | Persistent polite and assertive regions in the layout; reading status in `Alert role="status"`; failures `role="alert"`; Sonner mounted once; `aria-busy` while reading; the focus plan. | 3.0, 7.2 |
| A3, V4 (inputs), P13 (zoom) iOS zoom on 14px inputs | Inputs, selects and textarea `text-base md:text-sm` (16px on phones); no `maximum-scale`. | 2.2, 4.1 |
| A4, P13 (targets) Targets 31 to 41px | Button `h-11`, chips `min-h-11 gap-2`, `pointer-coarse:min-h-11` on sm, option cards 56px, checkbox row `py-3` as the label, slider thumb 24px with 44px hit, `touch-action: manipulation`, pressed states. | 2.6, 4.1 |
| A5, P3, V23 (example-first) Auto-run example scrolls the phone and fills the user's form | Since real data there is no example and no sample (REAL_DATA.md section 10): a "From the data" panel of real numbers sits beside the tool; nothing fills the form; no scroll on load. | 3.1, 3.4 |
| A6 innerHTML destroys focus; no focus moves | React keeps DOM identity; explicit focus plan; AlertDialog for Delete all. | 7.2 |
| A7 Errors before typing, disabled Compare | `mode: "onTouched"`; Compare never disabled; summary on submit; psf message attached to both fields. | 3.3 |
| A8, V8 Contrast: pills and input borders | New verdict tokens (5.26:1 and up) and `--input` (3.21:1 and up); petrol focus ring; indigo reserved for the stamp. | 2.1 |
| A9, P4 No steps on phones; 5 taps to a verdict | One step per screen with "Step x of 3" and URL steps; reading starts on file choice; strong match pre-selected, so two taps (choose, compare); sticky bottom action bar. | 3.0 to 3.4 |
| A10 Thin loading feedback | Real phases, 8 s message, Skeletons, button loading states, border-beam as motion-safe extra, static under reduced motion. | 3.2, 5.1 |
| A11 Drop zone is a focusable label, desktop copy, no Remove | Real Button plus sr-only file input; drop and paste copy only on fine pointers; Replace and Remove; drag counter. | 3.1, 3.2 |
| A12, V7, P8 Lead errors in toasts, JSON receipt, consent gaps | Field components with helper and inline errors; E.164 normalisation; plain receipt Alert; partner card with licence and contact promise from env; consent hash and audit; withdrawal kept and forwarded to the partner. | 3.4, 6.8 |
| A13, V21 Mortgage estimator a11y and copy | Slider with `aria-valuetext` and step buttons; debounced `<output>`; rate validated 1 to 12; "About AED 10,618 a month" leads; no animation; disclosure kept. | 3.4, 6.7 |
| A14 No `<form>`; request input unlabelled | `<form>` everywhere with submit buttons and `enterKeyHint`; visible label "Building name and area". | 3.7, 7.1 |
| A15, P5 Picker not grouped, raw scores | FieldSet and legend; RadioGroup cards 56px with focus ring; coverage line instead of scores; "Best match" badge; look-alike hint; covered-building search; match count announced. | 3.3 |
| A16, V14, P20 Header wraps, sync bar, admin in nav, hidden focus | 56px one-row header, no sync bar; menu Sheet; admin only at /admin; scroll padding for both bars; toasts top-centre on phones. Bottom tab bar deliberately not used (1.5). | 3.0 |
| A17, V1, P1 Demo labels missing where people look and share | Since real data there are no demo labels: every result names its source (DLD sales transactions on Data.Dubai, linked) and the date the data runs to, and shows the stale note when the data is old (REAL_DATA.md sections 7 and 9). | 5.4, 8 |
| A18, V15 Reduced motion and Magic UI risk | `MotionConfig reducedMotion="user"`; four Magic UI components with stated purposes and fallbacks; deny list; reduce-aware scroll helper. | 2.6, 4.2 |
| A19, V4 (scale) Type 11 to 15px, fractional sizes | Classic scale 14 to 48; 14px minimum in the DOM; consent at 16px; sentence-case labels. | 2.2 |
| A20 Tables scroll sideways at 360px | Stacked list below 640px; admin tables in a labelled, focusable region where scrolling remains. | 3.4, 3.8 |
| A21 Hash routes, badge without context, brand label | App Router routes; focus h1 on route change; sr-only "2 listings have new sales"; brand `<Link aria-label="Fairsquare home">`; skip link. | 3.0 |
| A22, V17, P2 Share loop broken | Server-made code; Web Share with the file in one tap; fallback drawer with WhatsApp, Download, visible link and Copy; /c page; OG image; refs stored and counted in admin. | 3.4, 3.5, 8 |
| A23 Destructive actions without undo or confirm | Inline Undo for removing a saved item; AlertDialog for withdraw, delete all and admin delete sale. | 3.6, 3.8 |
| A24, A25, V22, V23, P21, P22 Strengths to keep | Ported as listed in 1.3: stamp, mark, tokens, focus ring with offset, labels, consent pattern, recovery copy, guardrails, number formatting, reserved space, safe areas. Encoded as tests in 7.4. | 1.3, 7.4 |
| V2, P11 Stamp buried; result order | One stamped sheet as the single elevated object; figure only in the stamp; one badge and one sentence; fixed information order; one primary action. | 3.4 |
| V3 "Fairly priced" headline, "CHECKED" stamp | H1 "Compare a listing's price with recent sales in the same building"; stamp "FAIRSQUARE COMPARED" plus a date line. | 6.2, 8.2 |
| V5, P19 Chart unreadable on phones, arbitrary vertical position | HTML/CSS dot strip at real text sizes; stacking means density; shaded within-5% band; direct labels; 4 ticks on phones; visible summary; list or table below. | 3.4 |
| V6 Five font families | Archivo variable only; static stamp instances from the same file; no Arabic font (the Arabic name was dropped with the rename to Fairsquare). | 2.2 |
| V9 Traffic-light verdict colours; "Ready" reuses green | Diverging ochre, slate and blue with icons; coverage uses neutral badges. | 2.1 |
| V10 Card overuse, seven radii | One elevated sheet; unboxed flow with hairlines and accordions; four radius roles. | 2.4, 2.5 |
| V11 Caps tags, middle dots, arrows | Sentence-case badges; no dot strings or arrows in the UI; separators only inside the stamp; realistic placeholder. | 6 |
| V12, P9 "Save and alert me" over-promises; cookie loss; no undo; new code on reopen | "Save and track" and "Tracking" with the helper line; recovery link; inline undo; reopen keeps the code. | 3.4, 3.6 |
| V13 Mixed vocabulary, vendor leaks | One verb (compare); one AI disclosure line; no "Card code"; no "% match"; "Apartment" not "flat"; Quick fill removed. | 6 |
| V16 No arrival page | /c page and OG image specified. | 3.5, 8.4 |
| V18 No icon system | lucide mapping, one stroke, two sizes. | 2.7 |
| V19 Split logo | Mark as a one-colour miniature stamp; sentence-case wordmark; no Arabic name. | 2.8 |
| V20, P16 Long intro, judgment headline, tool buried | Hero is the tool; two-sentence lead; scope line; the real "From the data" panel beside it. | 3.1 |
| P6 Weak recovery from misreads | Per-field source marks; inline "Not in the screenshot"; screenshot beside the fields on desktop and one tap away on phones; Alerts with "It's for sale, continue" and "Type the details anyway"; `property_type` and `completion` in the schema; one bedroom range; edits counted for admin. | 3.3, 5.3 |
| P7 Provenance missing at the decision | Source and caveat lines under the sentence; "How Fairsquare compares" popover and page; "Not a valuation" on the card and /c. | 3.4, 3.9 |
| P10 Money step buried, missing for not-covered | Cost row in the result summary for every result type, including too few and not covered; Drawer or Sheet; down payment minimum from price. | 3.4 |
| P12 Dead-end fallback states | Too few: "1 of the 5 sales needed" with the sales that exist and Save first. Not covered: "Request it and track", search and the cost row. | 3.4 |
| P15 Admin lacks funnel, quality, CSV, lead status | Overview funnel with K-factor; Quality page; leads with status, masking, reveal log and export; CSV dry run; register-sale impact preview with empty fields; confirm before delete. | 3.8 |
| P17 Privacy promise hidden; agent details spread | Privacy line under the upload; /privacy page; "Hide contact details" trim before sharing. | 3.1, 3.4, 3.10 |
| P18 Villas, off-plan not handled | Schema fields; non-apartment Alert; off-plan notice and stamp line; scope line in the hero. | 3.3, 3.4 |

### 7.4 Acceptance tests (encode as Playwright and unit tests)

1. No verdict below 5 sales (`MIN_SALES`); the stamp shows "{count} OF 5" and the page shows "Too few sales to compare yet".
2. No automatic building choice below a 0.8 score; matches under 0.62 never appear; "None of these" always appears once a name is typed.
3. Price per sq ft outside 300 to 6000 blocks Compare with the message on both fields.
4. The consent checkbox is unticked on every render; name and mobile fields do not exist in the DOM before the tick.
5. Ready and off-plan sales are never pooled; the stale note shows on every result, the home page and /c when the data ends more than 45 days before today; the attribution links to the dataset and the licence (REAL_DATA.md sections 7 and 9).
6. Every error Alert contains at least one action button.
7. Stop aborts the server request (the route sees the abort signal).
8. Delete all deletes saved items and comparisons for the id (their /c links then 404), unlinks requests and events from the id, withdraws leads (name and full number erased, record kept as "withdrawn"), clears the cookie, and the admin Leads table then shows "Withdrawn on {date}. Tell the partner."
9. Nothing scrolls on page load; focus lands where 7.2 says.
10. axe has zero violations on every route in both themes at all four widths.

---

## 8. Share card, stamp geometry and OG image

Rebuilt by the result spec (sections 4.3, 8.1 and 8.3; owner decisions of 18 Nov 2026): the card and the OG image are Fairsquare documents on paper with no listing screenshot, no petrol band and no listing plate. The stamped screenshot sheet, "See the whole card" and the trim control are gone. The verdict stamp lives on the card and in the desktop card preview; the market scale lands a compact ASKING stamp on its pin.

### 8.1 Stamp geometry (`src/lib/stamp/geometry.ts`)

All values are relative to the stamp width `w`. The card uses w = 440px, the OG image w = 470px. h = 0.56w, rotated -9 degrees about the centre.

```
   w
 +------------------------------------------------+   outer border: stroke max(4, w/50), radius w/18
 | +--------------------------------------------+ |   inner border: inset 0.045w, stroke max(2, w/160), radius w/30
 | |       FAIRSQUARE  [scale]  IN LINE         | |   row A, centre y = 0.19h
 | |                                            | |
 | |                  +1.4%                     | |   row B (figure), centre y = 0.47h
 | |                                            | |
 | |   ------------------------------------     | |   rule, y = 0.655h, inset 0.06w from inner border, stroke max(2, w/200)
 | |    VS MEDIAN OF 43 REGISTERED SALES        | |   row C, centre y = 0.765h
 | |     2-BED  <>  12 MONTHS TO 16 NOV 2026    | |   row D, centre y = 0.865h
 | +--------------------------------------------+ |
 +------------------------------------------------+
```

| Row | Font | Size | Content |
|---|---|---|---|
| A, header | The stamp's wide face (`STAMP_FONTS.wide`, Archivo wdth 125, wght 700), letter-spacing 0.1em | 0.04w (17.6px on the card), fitted to the rule's span (0.79w) when longer | "FAIRSQUARE" + scale glyph (as tall as the font size, same stroke as the inner border) + the verdict word: IN LINE, ABOVE, BELOW or TOO FEW (`stamp.inLine`, `stamp.above`, `stamp.below`, `stamp.tooFew`). |
| B, figure | The condensed face (`STAMP_FONTS.condensed`, Archivo wdth 70, wght 780), tabular | starts at 0.38h, shrinks to fit the content width, minimum 0.2h | "+1.4%", "+15.4%", "−9.1%". Too few: "4 OF 5". |
| C | Stamp Wide, wght 700, letter-spacing 0.06em | 0.046w, fit to width | "VS MEDIAN OF 43 REGISTERED SALES". Too few: "SALES NEEDED TO COMPARE". |
| D | Stamp Wide, wght 700, letter-spacing 0.06em | 0.038w, fit to width | "2-BED" + diamond + "12 MONTHS TO 16 NOV 2026"; an off-plan comparison adds diamond + "OFF-PLAN". Separators are drawn diamonds (0.012w), not characters. |

- Ink: #3A37C9 at alpha 0.9, in every state and both themes: direction is in the words, the sign and the position.
- All caps and separators are allowed only on stamps: they are rubber-stamp vernacular.
- The date is the window's end; on /c it stays the comparison's own.
- **The compact ASKING stamp** (`layoutCompactStamp`, the market scale): 92 x 52 on phones, 116 x 65 from 768px; outer border 2px, inner 1px inset 3, radius 4; "ASKING" (wide 700, 11px or 13px, tracking 0.14em) over the asking price per sq ft (condensed 780, 20px or 26px, tabular); rotated -4 degrees; `--stamp` at 0.9 with half the full stamp's speckle. It is `aria-hidden`.

### 8.2 Texture

- **Speckle knockout:** `destination-out` dots. Count = w x h / 260. Radius 0.6 to 2.2px, scaled by w/691. Alpha 0.35 to 1.
- **Edge wear:** 24 more voids, radius 2 to 5px (scaled the same), within 0.06w of the outer border.
- **Seed:** mulberry32 seeded from the share code, so the same code always draws the same stamp.
- **SVG version (the compact stamp):** a `<mask>` built from `feTurbulence` and an `feComponentTransfer` threshold.
- **OG version:** Satori has no SVG filters. A pre-generated transparent PNG of paper-coloured (#F6F7F4) specks, 470 by 263, lies over the stamp (`src/assets/og/make-specks.mjs`).

### 8.3 The share card (`renderCard()`, client only, RESULT_SPEC section 8.1)

A 1080 x 1350 PNG (4:5), paper #F6F7F4, margins 64. Inks: ink #17191E, pencil #53646A, hairline #D9DCD6, stamp #3A37C9 at 0.9 (multiply). Verdict hues on the headline's figure words only: in line ink, above #8F4A0A, below #1E5B98.

| y | Part |
|---|---|
| 56 | The mark (40) and "Fairsquare" (Newsreader 600 36); "Compared 18 Nov 2026" (`card.compared`, Archivo 28 pencil) on the right. |
| 120 | 2px hairline. |
| 152 | The building as the listing names it (Newsreader 560 56/64; 46 on up to two lines when longer). |
| 224 | `card.listing`: "Ready 2-bed, 812 sq ft, asking AED 1,450,000" (Archivo 32/42 pencil); "2-bed, ..." when the listing didn't say ready or off-plan. |
| 300 | The verdict on two lines (Newsreader 520 72/76): "In line with / registered sales", "15.4% above / registered sales", "Too few sales / to compare yet". |
| 488 to 748 | "Asking, per sq ft" / "AED 1,786" and "Median of 43 sales, per sq ft" / "AED 1,761" (Archivo 500 28/36 pencil; 600 80/84 ink, semi-condensed, tabular). Too few: "Registered sales found" / "4 of the 5 needed" with 5 tally dots. |
| centre (790, 618) | The verdict stamp, w 440, -9 degrees, multiply. Printed, never animated. |
| 788 | When the recent-sales line triggers: a 4px ink rule, then `card.recent` and `card.recentLower` or `card.recentHigher` (Archivo 500 30/36 ink). |
| 892 (788 with no drift) | The mini scale, 952 x 180 (`scaleModel` variant "card"): 16px dots (pitch 16.5), the band, a 2px axis, the 18 x 12 fulcrum, the indigo pin and diamond, "Asking 1,786" (`card.askingLabel`, Archivo 700 30 indigo) 8px right of the pin, "Median" 26 pencil + "1,761" Archivo 600 34 ink, ticks Archivo 26 pencil. Too few: no scale; `card.thinLine` (or `card.thinZero`) in its place. |
| scale + 192 | `card.dots`: "Each dot is one registered sale. Filled: since 18 Aug." (Archivo 26/32 pencil); `card.dotsNoRecent` with no filled dot; `card.dotsQuantile` ("Each dot is about 3 registered sales. Filled: at least half since 18 Aug.") or `card.dotsQuantileNoRecent` with more than 80 sales. |
| 1140 | 2px hairline (lower when what is above needs the room). |
| 1160 | `card.source` (Archivo 26/32 pencil, wraps). |
| 1252 | `card.link`: "See all 43 sales: fairsquare.example/c/FYZ79D" (Archivo 700 30/38 ink); `card.linkOnly` with no sales. |

- The footer (hairline, source, link) slides down under a tall scale (a two-line building, the recent line, a tall column of dots), but the link never ends below y 1310. The mini scale gets the room left above it: when its tallest column would push the footer further, its dots shrink a pixel at a time (to 5px at the least) until it fits.

- Fonts: Newsreader 520, 560 and 600 and Archivo 400 to 700 through `document.fonts.load`, plus the two stamp faces as `FontFace`s. If they are not ready in 2 s it draws with Georgia, "Arial Narrow" and system-ui rather than block.
- Output: `fairsquare-{listing-slug}-{code}.png` from the listing's own building text (`share.fileName`). Rendering starts when the result is in (not in idle time), so the desktop preview is usually ready at the handover. The text alternative is `card.alt` (`card.altThin`).
- Never: the listing screenshot, an adviser offer, a monthly payment, ads, logos of the DLD or the Government of Dubai, emoji. Not covered: no card. Never uploaded.

### 8.4 OG image (`src/app/c/[code]/opengraph-image.tsx`, next/og, 1200 x 630, RESULT_SPEC section 8.3)

```
 64   [mark 40] Fairsquare                               Newsreader 600 32
120   Aykon City Tower C                                  Newsreader 560 52/56, max-w 470 (x 64-534)
184   Ready 2-bed, 812 sq ft, AED 1,450,000               og.listing, Archivo 30 pencil, semi-condensed
248   In line with                                        Newsreader 520 48/52, verdict hue on the figure words
      registered sales
380   Asking AED 1,786, median AED 1,761 per sq ft,       og.figures, Archivo 28 ink, semi-condensed, w 460
      43 registered sales
470   Last 90 days: AED 1,602 per sq ft (11 sales)        og.recent, Archivo 26 ink, when triggered
566   DLD open data via Data.Dubai. Data to 16 Nov 2026. Not a valuation.   og.source, Archivo 22 pencil
      the verdict stamp w 470, centre (770, 314), -9 deg, with the speck PNG on top
```

| Rule | Spec |
|---|---|
| Background | Paper #F6F7F4 to the edges: no petrol bar. |
| Building | One line, measured with the Newsreader 560 advance widths (Satori wraps a little early): 52px when it fits 500px (clear of the rotated stamp at that height), else 44 or 36, else cut with an ellipsis at 36. |
| Square-crop safety | WhatsApp sometimes centre-crops to a square (x 285 to 915). The stamp figure (about x 630 to 910) stays inside it. |
| Fonts | Static WOFF files read as ArrayBuffers: archivo-400, archivo-600, archivo-400-semicondensed (wdth 88), newsreader-520, newsreader-560, newsreader-600 (registered as weights 500, 600 and 700), and the two stamp faces. |
| Too few sales | "Too few sales / to compare yet", `og.figuresThin`, the TOO FEW stamp. Not covered: "Not covered yet", `og.sentenceNone`, no stamp. |
| Size | Under 600 KB (about 90 KB). The image shows the stored comparison, whose numbers and date never change. It is cached for an hour (`public, max-age=3600, stale-while-revalidate=86400`), not as immutable, so the image of a deleted comparison expires. The live "Today" figures appear only on the /c page. |
| Alt | `c.ogAlt`: "Fairsquare comparison: asking AED 1,786 per sq ft, median AED 1,761 of 43 registered sales." |
| Metadata | `og:title` `c.ogTitle` (no branding), `og:description` `c.ogDescLive`, `twitter:card` `summary_large_image`. |
