/**
 * Share helpers (DESIGN.md section 3.4, the growth loop), client only:
 * - the Web Share path with the card file (one tap, the native sheet);
 * - the fallbacks: a WhatsApp link, a download, and copying the /c link.
 * A person cancelling the share sheet is an AbortError and shows nothing.
 */

export type ShareOutcome = "shared" | "cancelled" | "failed";

/** `https://wa.me/?text=` with the encoded share text (which already ends with the /c URL). */
export function whatsappUrl(text: string): string {
  return `https://wa.me/?text=${encodeURIComponent(text)}`;
}

/** True when this browser can share the card file through the native sheet. */
export function canShareFiles(file: File | null): file is File {
  if (!file || typeof navigator === "undefined") return false;
  if (typeof navigator.share !== "function" || typeof navigator.canShare !== "function") return false;
  try {
    return navigator.canShare({ files: [file] });
  } catch {
    return false;
  }
}

function isAbort(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { name?: string }).name === "AbortError";
}

/**
 * `navigator.share({ files, text, url })`. Call it synchronously inside the tap (iOS requires a
 * user activation), with the file already built.
 */
export async function shareCardFile(file: File, text: string, url: string): Promise<ShareOutcome> {
  try {
    await navigator.share({ files: [file], text, url });
    return "shared";
  } catch (err) {
    return isAbort(err) ? "cancelled" : "failed";
  }
}

/** Saves a file through a temporary object URL (nothing leaves the device). */
export function downloadFile(file: File): void {
  const url = URL.createObjectURL(file);
  const a = document.createElement("a");
  a.href = url;
  a.download = file.name;
  a.rel = "noopener";
  a.style.display = "none";
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** Copies text with the async Clipboard API. False when it is blocked or missing. */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (typeof navigator === "undefined" || !navigator.clipboard?.writeText) return false;
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
