/**
 * LLM provider contract.
 *
 * Every AI task in the game (NPC turn, evaluation, memory extraction, ...)
 * talks to this interface and nothing else. Providers are swappable via env
 * (see `./registry.ts`). Keep this surface small: text in, text out, with
 * optional streaming. Structured output is handled *above* this layer by
 * `./json.ts` + zod schemas so it works identically for every provider.
 */

export type ChatRole = "system" | "user" | "assistant";

export interface ChatMessage {
  role: ChatRole;
  content: string;
}

export interface CompletionRequest {
  /** Stable system prompt. Providers may cache it. */
  system: string;
  messages: ChatMessage[];
  maxTokens: number;
  temperature?: number;
  /** Hint for providers that support reasoning effort. */
  effort?: "low" | "medium" | "high";
  /** Task label for logging & model routing (e.g. "npc_turn"). */
  task: AITaskName;
  /** Optional stop sequences. */
  stop?: string[];
  /** Ask the provider for strict JSON if it can (OpenAI-style json mode). */
  jsonMode?: boolean;
}

export interface CompletionResult {
  text: string;
  model: string;
  usage: { inputTokens: number; outputTokens: number };
  /** Provider-specific stop reason, normalised loosely. */
  stopReason: "end" | "max_tokens" | "refusal" | "other";
}

export type AITaskName = "npc_turn" | "npc_opening" | "evaluate" | "extract_memory" | "recommend";

export interface LLMProvider {
  readonly name: string;
  complete(req: CompletionRequest): Promise<CompletionResult>;
  /**
   * Stream text deltas. Must resolve to the same shape as `complete` once done.
   * Providers without native streaming may emit a single chunk.
   */
  stream(req: CompletionRequest, onDelta: (delta: string) => void): Promise<CompletionResult>;
}

export class AIProviderError extends Error {
  constructor(
    message: string,
    public readonly provider: string,
    public readonly retryable: boolean,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = "AIProviderError";
  }
}
