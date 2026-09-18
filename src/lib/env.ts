/**
 * Environment configuration, validated once at import time.
 * Never read process.env elsewhere; import `env` from here.
 */
import { z } from "zod";

const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.string().default("file:./data/game.db"),
  DATABASE_AUTH_TOKEN: z.string().optional(),
  SESSION_SECRET: z.string().min(16).default("dev-only-secret-change-me-please-32chars"),

  /** Which LLM backend to use. */
  AI_PROVIDER: z.enum(["anthropic", "openrouter", "fake"]).default("fake"),
  ANTHROPIC_API_KEY: z.string().optional(),
  OPENROUTER_API_KEY: z.string().optional(),
  OPENROUTER_BASE_URL: z.string().default("https://openrouter.ai/api/v1"),
  /** Default model id for the chosen provider. */
  AI_MODEL: z.string().optional(),
  /** Optional per-task model overrides. */
  AI_MODEL_NPC: z.string().optional(),
  AI_MODEL_EVAL: z.string().optional(),
  AI_MODEL_MEMORY: z.string().optional(),

  /** Analytics: "console" logs events; "none" is silent. Events are always stored in DB. */
  ANALYTICS_SINK: z.enum(["console", "none"]).default("console"),
  LOG_AI_CALLS: z
    .string()
    .default("true")
    .transform((v) => v !== "false" && v !== "0"),
});

export type Env = z.infer<typeof EnvSchema>;

function load(): Env {
  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    const msg = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`Invalid environment configuration:\n${msg}`);
  }
  const env = parsed.data;
  // Enforced at runtime only; `next build` evaluates modules without production secrets.
  const building = process.env.NEXT_PHASE === "phase-production-build";
  if (env.NODE_ENV === "production" && !building && env.SESSION_SECRET.startsWith("dev-only")) {
    throw new Error("SESSION_SECRET must be set in production");
  }
  return env;
}

export const env: Env = load();
