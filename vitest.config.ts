import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    env: { AI_PROVIDER: "fake", DATABASE_URL: ":memory:", NODE_ENV: "test" },
  },
  resolve: {
    alias: { "@": path.resolve(__dirname, "src") },
  },
});
