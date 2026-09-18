/**
 * Anthropic provider (official SDK).
 *
 * Model routing per task is configurable via env (see registry). Defaults to
 * `claude-opus-5`. NPC turns run at low effort for conversational latency;
 * evaluation runs at higher effort.
 */
import Anthropic from "@anthropic-ai/sdk";
import { AIProviderError, type CompletionRequest, type CompletionResult, type LLMProvider } from "../provider";

export interface AnthropicProviderOptions {
  apiKey?: string;
  /** Model per task, falling back to `defaultModel`. */
  models?: Partial<Record<CompletionRequest["task"], string>>;
  defaultModel?: string;
}

export class AnthropicProvider implements LLMProvider {
  readonly name = "anthropic";
  private client: Anthropic;
  private models: Partial<Record<CompletionRequest["task"], string>>;
  private defaultModel: string;

  constructor(opts: AnthropicProviderOptions = {}) {
    this.client = new Anthropic(opts.apiKey ? { apiKey: opts.apiKey } : {});
    this.models = opts.models ?? {};
    this.defaultModel = opts.defaultModel ?? "claude-opus-5";
  }

  private modelFor(task: CompletionRequest["task"]): string {
    return this.models[task] ?? this.defaultModel;
  }

  private buildParams(req: CompletionRequest): Anthropic.MessageCreateParamsNonStreaming {
    const messages: Anthropic.MessageParam[] = req.messages
      .filter((m) => m.role !== "system")
      .map((m) => ({ role: m.role as "user" | "assistant", content: m.content }));
    // The API requires the first message to be from the user.
    if (messages.length === 0 || messages[0].role !== "user") {
      messages.unshift({ role: "user", content: "(begin)" });
    }
    const params: Anthropic.MessageCreateParamsNonStreaming = {
      model: this.modelFor(req.task),
      max_tokens: req.maxTokens,
      system: [{ type: "text", text: req.system, cache_control: { type: "ephemeral" } }],
      messages,
      output_config: { effort: req.effort ?? "medium" },
    };
    if (req.stop?.length) params.stop_sequences = req.stop;
    return params;
  }

  async complete(req: CompletionRequest): Promise<CompletionResult> {
    try {
      const res = await this.client.messages.create(this.buildParams(req));
      return this.toResult(res);
    } catch (err) {
      throw this.wrap(err);
    }
  }

  async stream(req: CompletionRequest, onDelta: (delta: string) => void): Promise<CompletionResult> {
    try {
      const stream = this.client.messages.stream(this.buildParams(req));
      for await (const event of stream) {
        if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
          onDelta(event.delta.text);
        }
      }
      const final = await stream.finalMessage();
      return this.toResult(final);
    } catch (err) {
      throw this.wrap(err);
    }
  }

  private toResult(res: Anthropic.Message): CompletionResult {
    const text = res.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("");
    const stopReason: CompletionResult["stopReason"] =
      res.stop_reason === "end_turn" || res.stop_reason === "stop_sequence"
        ? "end"
        : res.stop_reason === "max_tokens"
          ? "max_tokens"
          : res.stop_reason === "refusal"
            ? "refusal"
            : "other";
    return {
      text,
      model: res.model,
      usage: { inputTokens: res.usage.input_tokens, outputTokens: res.usage.output_tokens },
      stopReason,
    };
  }

  private wrap(err: unknown): AIProviderError {
    if (err instanceof Anthropic.RateLimitError) return new AIProviderError("Rate limited", this.name, true, err);
    if (err instanceof Anthropic.AuthenticationError) return new AIProviderError("Invalid Anthropic API key", this.name, false, err);
    if (err instanceof Anthropic.BadRequestError) return new AIProviderError(`Bad request: ${err.message}`, this.name, false, err);
    if (err instanceof Anthropic.APIConnectionError) return new AIProviderError("Connection error", this.name, true, err);
    if (err instanceof Anthropic.APIError) return new AIProviderError(`API error ${err.status}: ${err.message}`, this.name, (err.status ?? 500) >= 500, err);
    return new AIProviderError((err as Error)?.message ?? "Unknown error", this.name, false, err);
  }
}
