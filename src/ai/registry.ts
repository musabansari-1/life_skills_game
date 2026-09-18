/**
 * Provider registry: picks the LLM backend from env. Game code never
 * instantiates a provider directly; it asks for `getLLMProvider()`.
 *
 * Swap providers by setting AI_PROVIDER=anthropic|openrouter|fake.
 */
import { env } from "@/lib/env";
import type { LLMProvider } from "./provider";
import { AnthropicProvider } from "./providers/anthropic";
import { FakeProvider } from "./providers/fake";
import { OpenAICompatibleProvider } from "./providers/openai-compatible";

let cached: LLMProvider | null = null;

export function getLLMProvider(): LLMProvider {
  if (cached) return cached;
  cached = createProviderFromEnv();
  return cached;
}

/** Test hook. */
export function setLLMProvider(p: LLMProvider | null) {
  cached = p;
}

export function createProviderFromEnv(): LLMProvider {
  const models = {
    npc_turn: env.AI_MODEL_NPC,
    npc_opening: env.AI_MODEL_NPC,
    evaluate: env.AI_MODEL_EVAL,
    extract_memory: env.AI_MODEL_MEMORY,
    recommend: env.AI_MODEL_MEMORY,
  };
  switch (env.AI_PROVIDER) {
    case "anthropic":
      if (!env.ANTHROPIC_API_KEY) console.warn("[ai] AI_PROVIDER=anthropic but ANTHROPIC_API_KEY is not set; relying on SDK credential resolution");
      return new AnthropicProvider({ apiKey: env.ANTHROPIC_API_KEY, models, defaultModel: env.AI_MODEL ?? "claude-opus-5" });
    case "openrouter":
      if (!env.OPENROUTER_API_KEY) throw new Error("AI_PROVIDER=openrouter requires OPENROUTER_API_KEY");
      return new OpenAICompatibleProvider({
        name: "openrouter",
        apiKey: env.OPENROUTER_API_KEY,
        baseUrl: env.OPENROUTER_BASE_URL,
        models,
        defaultModel: env.AI_MODEL ?? "anthropic/claude-sonnet-5",
        extraHeaders: { "HTTP-Referer": "http://localhost:3000", "X-Title": "Life Skills RPG" },
      });
    case "fake":
    default:
      return new FakeProvider();
  }
}
