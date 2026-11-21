/** Parse details a person types or pastes, e.g. "2 bed, 1284 sqft, 2.45m" (port of textparse.py). */

export interface ParsedFields {
  bedrooms?: number;
  sizeSqft?: number;
  priceAed?: number;
}

const SQM_TO_SQFT = 10.7639;

const BEDS_RE = /(\d+)\s*(?:br|bed|beds|bedroom|bedrooms|bhk)\b/;
const SQFT_RE = /(\d+(?:\.\d+)?)\s*(?:sq\.?\s*ft|sqft|sft|square feet|ft2)/;
const SQM_RE = /(\d+(?:\.\d+)?)\s*(?:sq\.?\s*m|sqm|m2)\b/;
const PRICE_SUFFIX_RE = /(?:aed|dhs?|د\.إ)?\s*(\d+(?:\.\d+)?)\s*(m|mn|million|k)\b/;
const PRICE_AED_RE = /(?:aed|dhs?)\s*(\d{5,9})/;
const BARE_RE = /\b(\d{6,9})\b/g;

export function parseFields(text: string): ParsedFields {
  const t = String(text ?? "").toLowerCase().replace(/,/g, "");
  const out: ParsedFields = {};
  let m: RegExpExecArray | null;

  if (/\bstudio\b/.test(t)) out.bedrooms = 0;
  else if ((m = BEDS_RE.exec(t))) out.bedrooms = Number(m[1]);

  if ((m = SQFT_RE.exec(t))) out.sizeSqft = Number(m[1]);
  else if ((m = SQM_RE.exec(t))) out.sizeSqft = Math.round(Number(m[1]) * SQM_TO_SQFT * 10) / 10;

  if ((m = PRICE_SUFFIX_RE.exec(t))) {
    out.priceAed = Math.round(Number(m[1]) * (m[2] === "k" ? 1_000 : 1_000_000));
  } else if ((m = PRICE_AED_RE.exec(t))) {
    out.priceAed = Number(m[1]);
  } else {
    const bare = [...t.matchAll(BARE_RE)].map((x) => Number(x[1]));
    if (bare.length) out.priceAed = Math.max(...bare);
  }
  return out;
}
