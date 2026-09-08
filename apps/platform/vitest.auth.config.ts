import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.test.jsonc" },
      miniflare: {
        bindings: {
          APP_ENV: "production",
          AUTH_MODE: "access",
          ACCESS_TEAM_DOMAIN: "https://unit-test.cloudflareaccess.com",
          ACCESS_AUD: "unit-test-audience",
        },
      },
    }),
  ],
  test: { include: ["tests/api-auth.integration.test.ts"] },
});
