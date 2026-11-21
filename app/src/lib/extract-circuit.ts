import "server-only";
/**
 * Screenshot-reading switch and in-process circuit breaker (A§5.6, DESIGN.md section 5.6).
 * - No ANTHROPIC_API_KEY → reading is off.
 * - Three consecutive `server_fail` outcomes (extract_failed, extract_timeout) open the circuit for 5 minutes.
 * - One `ok` resets the count; `other` (refusals, bad images, rate limits) never trips it.
 * WP2 records each outcome; getPublicConfig() reads extractionEnabled().
 */
import { getEnv } from "@/lib/env";
import { log } from "@/lib/log";

export const CIRCUIT_THRESHOLD = 3;
export const CIRCUIT_OPEN_MS = 5 * 60 * 1000;

interface CircuitState {
  failures: number;
  openUntil: number;
}

const g = globalThis as typeof globalThis & { __mizanExtractCircuit?: CircuitState };
const state = (): CircuitState => (g.__mizanExtractCircuit ??= { failures: 0, openUntil: 0 });

/** True when a key is set and the circuit is closed. */
export function extractionEnabled(now: number = Date.now()): boolean {
  if (!getEnv().ANTHROPIC_API_KEY) return false;
  const s = state();
  if (s.openUntil === 0) return true;
  if (now < s.openUntil) return false;
  // The open period has passed: close the circuit and start counting again.
  s.openUntil = 0;
  s.failures = 0;
  return true;
}

export function recordExtractOutcome(kind: "ok" | "server_fail" | "other", now: number = Date.now()): void {
  const s = state();
  if (kind === "ok") {
    s.failures = 0;
    return;
  }
  if (kind === "other") return;
  s.failures += 1;
  if (s.failures >= CIRCUIT_THRESHOLD && (s.openUntil === 0 || now >= s.openUntil)) {
    s.openUntil = now + CIRCUIT_OPEN_MS;
    log.warn("extract_circuit_open", { failures: s.failures, openForMs: CIRCUIT_OPEN_MS });
  }
}

export function __resetCircuitForTests(): void {
  g.__mizanExtractCircuit = { failures: 0, openUntil: 0 };
}
