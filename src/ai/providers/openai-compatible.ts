/**
 * OpenAI-compatible chat-completions provider.
 *
 * Used for OpenRouter (and any other endpoint speaking the same wire format)
 * so non-Anthropic models can be plugged in without touching game code.
 * Implemented with fetch to avoid a second SDK dependency.
 */
import { AIProviderError, type CompletionRequest, type CompletionResult, type LLMProvider } from "../provider";

export interface OpenAICompatibleOptions {
  apiKey: string;
  baseUrl: string; // e.g. https://openrouter.ai/api/v1
  models?: Partial<Record<CompletionRequest["task"], string>>;
  defaultModel: string;
  name?: string;
  extraHeaders?: Record<string, string>;
}

export class OpenAICompatibleProvider implements LLMProvider {
  readonly name: string;
  constructor(private opts: OpenAICompatibleOptions) {
    this.name = opts.name ?? "openai-compatible";
  }

  private modelFor(task: CompletionRequest["task"]) {
    return this.opts.models?.[task] ?? this.opts.defaultModel;
  }

  private body(req: CompletionRequest, stream: boolean) {
    const model = this.modelFor(req.task);
    const body: Record<string, unknown> = {
      model,
      max_tokens: req.maxTokens,
      temperature: req.temperature ?? 0.7,
      stream,
      messages: [{ role: "system", content: req.systemVolatile ? `${req.system}\n\n${req.systemVolatile}` : req.system }, ...req.messages.map((m) => ({ role: m.role, content: m.content }))],
    };
    if (req.stop?.length) body.stop = req.stop;
    if (req.jsonMode) body.response_format = { type: "json_object" };
    if (stream) body.stream_options = { include_usage: true };
    // Reasoning models spend the output budget on hidden thinking. Conversational
    // turns usually want none; structured tasks want a little. Some OpenRouter
    // endpoints (notably Space Bunny) require reasoning and reject `enabled:false`,
    // so let those models use their endpoint default unless high effort is requested.
    const requiresReasoning = /^stealth\/space-bunny/i.test(model);
    if (requiresReasoning) body.reasoning = { effort: "low" };
    else if (req.effort === "high") body.reasoning = { effort: "low" };
    else body.reasoning = { enabled: false };
    return body;
  }

  /** Some open models leak <think>…</think> into content; never surface it. */
  private stripThinking(text: string): string {
    return text.replace(/<think>[\s\S]*?<\/think>/gi, "").replace(/^<think>[\s\S]*$/i, "").trim();
  }

  private headers() {
    return {
      "Content-Type": "application/json",
      Authorization: `Bearer ${this.opts.apiKey}`,
      ...(this.opts.extraHeaders ?? {}),
    };
  }

  async complete(req: CompletionRequest): Promise<CompletionResult> {
    const res = await this.fetchWithRetry(this.body(req, false), 2, req.signal);
    const json = (await res.json()) as {
      model?: string;
      choices?: { message?: { content?: string }; finish_reason?: string }[];
      usage?: { prompt_tokens?: number; completion_tokens?: number };
      error?: { message?: string };
    };
    if (json.error) throw new AIProviderError(json.error.message ?? "Provider error", this.name, false);
    const choice = json.choices?.[0];
    return {
      text: this.stripThinking(choice?.message?.content ?? ""),
      model: json.model ?? this.modelFor(req.task),
      usage: { inputTokens: json.usage?.prompt_tokens ?? 0, outputTokens: json.usage?.completion_tokens ?? 0 },
      stopReason: choice?.finish_reason === "length" ? "max_tokens" : choice?.finish_reason === "content_filter" ? "refusal" : "end",
    };
  }

  async stream(req: CompletionRequest, onDelta: (delta: string) => void): Promise<CompletionResult> {
    const res = await this.fetchWithRetry(this.body(req, true), 2, req.signal);
    if (!res.body) throw new AIProviderError("No response body", this.name, true);
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let text = "";
    let emittedLen = 0;
    let model = this.modelFor(req.task);
    let usage = { inputTokens: 0, outputTokens: 0 };
    let stopReason: CompletionResult["stopReason"] = "end";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let idx: number;
      while ((idx = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, idx).trim();
        buffer = buffer.slice(idx + 1);
        if (!line.startsWith("data:")) continue;
        const data = line.slice(5).trim();
        if (data === "[DONE]") continue;
        let evt: {
          model?: string;
          choices?: { delta?: { content?: string }; finish_reason?: string | null }[];
          usage?: { prompt_tokens?: number; completion_tokens?: number };
          error?: { message?: string };
        };
        try {
          evt = JSON.parse(data);
        } catch {
          continue;
        }
        if (evt.error) throw new AIProviderError(evt.error.message ?? "Provider error", this.name, false);
        if (evt.model) model = evt.model;
        const delta = evt.choices?.[0]?.delta?.content;
        if (delta) {
          text += delta;
          // Hold back deltas while inside a leaked <think> block.
          const open = text.lastIndexOf("<think>");
          const close = text.lastIndexOf("</think>");
          const insideThink = open >= 0 && close < open;
          if (!insideThink) {
            const visible = this.stripThinking(text);
            const emitted = visible.slice(emittedLen);
            if (emitted) onDelta(emitted);
            emittedLen = visible.length;
          }
        }
        const fr = evt.choices?.[0]?.finish_reason;
        if (fr === "length") stopReason = "max_tokens";
        if (evt.usage) usage = { inputTokens: evt.usage.prompt_tokens ?? 0, outputTokens: evt.usage.completion_tokens ?? 0 };
      }
    }
    return { text: this.stripThinking(text), model, usage, stopReason };
  }

  private async fetchWithRetry(body: unknown, attempts = 2, signal?: AbortSignal): Promise<Response> {
    let lastErr: unknown;
    for (let i = 0; i < attempts; i++) {
      signal?.throwIfAborted();
      try {
        const res = await fetch(`${this.opts.baseUrl.replace(/\/$/, "")}/chat/completions`, {
          method: "POST",
          headers: this.headers(),
          body: JSON.stringify(body),
          signal,
        });
        if (res.ok) return res;
        const txt = await res.text().catch(() => "");
        const retryable = res.status === 429 || res.status >= 500;
        lastErr = new AIProviderError(`HTTP ${res.status}: ${txt.slice(0, 300)}`, this.name, retryable);
        if (!retryable) throw lastErr;
      } catch (err) {
        signal?.throwIfAborted();
        if (err instanceof AIProviderError && !err.retryable) throw err;
        lastErr = err instanceof AIProviderError ? err : new AIProviderError((err as Error).message, this.name, true, err);
      }
      await new Promise((r) => setTimeout(r, 400 * (i + 1)));
    }
    throw lastErr;
  }
}
