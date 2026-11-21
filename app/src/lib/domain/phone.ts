/** Phone numbers: normalise to E.164 (UAE-first), mask for display. */

const E164_RE = /^\+[1-9]\d{7,14}$/;

/** Returns E.164 ("+971501234567") or null when the input is not a usable number. */
export function normalisePhone(input: string): string | null {
  let s = String(input ?? "").replace(/[\s\-.()]/g, "");
  if (!s) return null;
  if (s.startsWith("00")) s = `+${s.slice(2)}`;
  if (/^05\d{8}$/.test(s)) s = `+971${s.slice(1)}`;
  else if (/^5\d{8}$/.test(s)) s = `+971${s}`;
  else if (/^9715\d{8}$/.test(s)) s = `+${s}`;
  return E164_RE.test(s) ? s : null;
}

export function last4(e164: string): string {
  return e164.replace(/\D/g, "").slice(-4);
}

/** "+971 •• ••• 4567". Other countries keep their first two digits: "+44 •• ••• 0123". */
export function maskPhone(e164: string): string {
  const prefix = e164.startsWith("+971") ? "+971" : e164.slice(0, 3);
  return `${prefix} •• ••• ${last4(e164)}`;
}
