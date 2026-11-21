/**
 * A fake Anthropic client for extraction tests (A§8.1). No network, no key.
 *   const fake = fakeAnthropic(claudeMessage(MARINA_EXTRACTION), { error: apiError(Anthropic.RateLimitError, 429) }, "hang");
 *   __setAnthropicForTests(fake.client);
 *   … fake.calls[0].effort === "low"; fake.calls.length counts Claude calls.
 * Each `beta.messages.create` call takes the next step:
 * - a message object → resolves with it;
 * - `{ error }` → rejects with it;
 * - "hang" → never settles (ignores the signal, like a stuck upstream);
 * - "hang-until-abort" → settles only when the request signal aborts, rejecting like the SDK does.
 * Error instances are built with `Object.create(Class.prototype)` so no constructor signature is guessed.
 */
import Anthropic from "@anthropic-ai/sdk";

export type FakeStep = Anthropic.Beta.BetaMessage | { error: unknown } | "hang" | "hang-until-abort";

export interface RecordedCall {
  params: Anthropic.Beta.MessageCreateParamsNonStreaming;
  options: { signal?: AbortSignal } | undefined;
  model: string;
  maxTokens: number;
  effort: unknown;
  format: unknown;
  schema: unknown;
  betas: unknown;
  fallbacks: unknown;
  hasThinking: boolean;
}

export interface FakeAnthropic {
  client: { beta: { messages: { create: (params: unknown, options?: unknown) => Promise<Anthropic.Beta.BetaMessage> } } };
  calls: RecordedCall[];
  /** Steps not yet used. */
  readonly remaining: number;
  push(...steps: FakeStep[]): void;
}

export function fakeAnthropic(...initial: FakeStep[]): FakeAnthropic {
  const steps = [...initial];
  const calls: RecordedCall[] = [];
  const create = (rawParams: unknown, rawOptions?: unknown): Promise<Anthropic.Beta.BetaMessage> => {
    const params = rawParams as Anthropic.Beta.MessageCreateParamsNonStreaming;
    const options = rawOptions as { signal?: AbortSignal } | undefined;
    const oc = params.output_config as { effort?: unknown; format?: { schema?: unknown } } | undefined;
    calls.push({
      params,
      options,
      model: params.model,
      maxTokens: params.max_tokens,
      effort: oc?.effort,
      format: oc?.format,
      schema: oc?.format?.schema,
      betas: params.betas,
      fallbacks: (params as { fallbacks?: unknown }).fallbacks,
      hasThinking: Object.prototype.hasOwnProperty.call(params, "thinking"),
    });
    const step = steps.shift();
    if (step === undefined) return Promise.reject(new Error("fakeAnthropic: no response queued"));
    if (step === "hang") return new Promise<never>(() => undefined);
    if (step === "hang-until-abort") {
      return new Promise<never>((_, reject) => {
        const signal = options?.signal;
        const fail = () => reject(Object.create(Anthropic.APIUserAbortError.prototype) as Error);
        if (signal?.aborted) fail();
        else signal?.addEventListener("abort", fail, { once: true });
      });
    }
    if (typeof step === "object" && step !== null && "error" in step && !("type" in step)) {
      return Promise.reject((step as { error: unknown }).error);
    }
    return Promise.resolve(step as Anthropic.Beta.BetaMessage);
  };
  return {
    client: { beta: { messages: { create } } },
    calls,
    get remaining() {
      return steps.length;
    },
    push(...more: FakeStep[]) {
      steps.push(...more);
    },
  };
}

/** An SDK error instance of `Class` with `status` set, built without calling its constructor. */
export function apiError<T extends abstract new (...args: never[]) => unknown>(Class: T, status?: number): InstanceType<T> {
  const err = Object.create(Class.prototype) as InstanceType<T> & { status?: number; message: string };
  if (status !== undefined) err.status = status;
  err.message = `fake ${Class.name}`;
  return err;
}

/** The raw JSON Claude returns for the Marina sample screenshot (A§2.4 known case). */
export const MARINA_EXTRACTION = {
  is_listing: true,
  listing_type: "sale",
  property_type: "apartment",
  completion: "ready",
  building_text: "Mockup Crest",
  area_text: "Dubai Marina",
  bedrooms: 2,
  size_sqft: 1284,
  price_aed: 2_450_000,
  contact_details_visible: true,
} as const;

export interface MessageOverrides {
  stop_reason?: Anthropic.Beta.BetaStopReason;
  stop_details?: { type: "refusal"; category: string | null; explanation?: string | null } | null;
  model?: string;
  content?: unknown[];
  iterations?: unknown[] | null;
  inputTokens?: number;
  outputTokens?: number;
}

/** A Claude response whose text block is `body` (an object is JSON-encoded; a string is sent as is). */
export function claudeMessage(body: object | string, o: MessageOverrides = {}): Anthropic.Beta.BetaMessage {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  return {
    id: "msg_fake_0001",
    type: "message",
    role: "assistant",
    model: o.model ?? "claude-opus-5-5",
    content: o.content ?? [{ type: "text", text, citations: null }],
    stop_reason: o.stop_reason ?? "end_turn",
    stop_sequence: null,
    stop_details: o.stop_details ?? null,
    container: null,
    context_management: null,
    usage: {
      input_tokens: o.inputTokens ?? 1500,
      output_tokens: o.outputTokens ?? 90,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
      iterations: o.iterations ?? null,
    },
  } as unknown as Anthropic.Beta.BetaMessage;
}

export function refusalMessage(category: string | null = "cyber"): Anthropic.Beta.BetaMessage {
  return claudeMessage("", {
    stop_reason: "refusal",
    stop_details: { type: "refusal", category, explanation: null },
    content: [],
    iterations: [{ type: "message" }, { type: "fallback_message" }],
  });
}

export function maxTokensMessage(): Anthropic.Beta.BetaMessage {
  return claudeMessage('{"is_listing": true, "listing_type": "sa', { stop_reason: "max_tokens" });
}
