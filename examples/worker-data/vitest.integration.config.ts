import path from "node:path";
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

export default defineConfig(async () => {
  const migrations = await readD1Migrations(
    path.join(import.meta.dirname, "migrations"),
  );
  return {
    plugins: [
      cloudflareTest({
        wrangler: { configPath: "./wrangler.local.jsonc" },
        miniflare: {
          bindings: {
            TEST_MIGRATIONS: migrations,
            REGISTRATION_TOKEN: `ucrt_${"t".repeat(43)}`,
          },
          compatibilityFlags: ["service_binding_extra_handlers"],
        },
      }),
    ],
    test: {
      include: ["tests/**/*.integration.test.ts"],
      setupFiles: ["./tests/apply-migrations.ts"],
    },
  };
});
