import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    exclude: ["tests/**/*.integration.test.ts"],
    coverage: {
      provider: "v8",
      include: ["src/domain/**/*.ts", "src/infrastructure/cron/**/*.ts"],
      thresholds: { branches: 90, functions: 90, lines: 90, statements: 90 },
    },
  },
});
