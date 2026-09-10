import path from "node:path";
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

const TEST_ADMIN_PASSWORD_HASH =
  "pbkdf2-sha256$600000$MDEyMzQ1Njc4OWFiY2RlZg$YVNTOas3Ktj9Bxo0o7TgbDWqVSP6iO1YpNUrQDQGjgA";

export default defineConfig(async () => {
  const migrations = await readD1Migrations(
    path.join(import.meta.dirname, "migrations"),
  );
  return {
    plugins: [
      cloudflareTest({
        wrangler: { configPath: "./wrangler.test.jsonc" },
        miniflare: {
          bindings: {
            TEST_MIGRATIONS: migrations,
            ADMIN_PASSWORD_HASH: TEST_ADMIN_PASSWORD_HASH,
          },
        },
      }),
    ],
    test: {
      include: ["tests/**/*.integration.test.ts"],
      setupFiles: ["./tests/apply-migrations.ts"],
      deps: {
        optimizer: {
          ssr: { enabled: true, include: ["cron-parser"] },
        },
      },
    },
  };
});
