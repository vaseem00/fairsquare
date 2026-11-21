import "server-only";
/**
 * The Anthropic client (A§5.1), created lazily on first use.
 *
 * Checked against the installed @anthropic-ai/sdk 1.9.0 (its README does not mention these, but its
 * type definitions and runtime do): the client options `maxRetries` and `timeout` (ms) exist, and the
 * per-request options argument accepts `{ signal }`. So:
 * - `maxRetries: 0`: retrying is a user action ("Try again"), and a read is capped at 25 s end to end.
 * - `timeout`: a backstop a little above CLAUDE_TIMEOUT_MS; our own deadline signal fires first and is
 *   what produces `extract_timeout`.
 * - `extractListing` passes `{ signal }` (the upstream request is cancelled) and also races the call
 *   against that signal, so a stuck call can never outlive the deadline.
 * `new Anthropic()` reads ANTHROPIC_API_KEY from the environment; it is never logged.
 */
import Anthropic from "@anthropic-ai/sdk";
import { getEnv } from "@/lib/env";

export { extractionEnabled } from "@/lib/extract-circuit";

/** Extra time the SDK's own timeout allows beyond our deadline, so the deadline always fires first. */
export const SDK_TIMEOUT_MARGIN_MS = 2_000;

/** The part of the client that extraction uses (a test fake implements just this). */
export interface AnthropicLike {
  beta: { messages: { create: Anthropic["beta"]["messages"]["create"] } };
}

let client: AnthropicLike | null = null;
let fake: AnthropicLike | null = null;

export function getAnthropic(): AnthropicLike {
  if (fake) return fake;
  client ??= new Anthropic({
    maxRetries: 0,
    timeout: getEnv().CLAUDE_TIMEOUT_MS + SDK_TIMEOUT_MARGIN_MS,
  });
  return client;
}

/** Tests: use a fake client (tests/helpers/fake-anthropic.ts); null restores the real one. */
export function __setAnthropicForTests(f: unknown): void {
  fake = (f as AnthropicLike | null) ?? null;
  client = null;
}
