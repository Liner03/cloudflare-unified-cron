import { env } from "cloudflare:workers";
import { applyD1Migrations } from "cloudflare:test";

// The plugin and generated runtime declarations duplicate this nominal type at lint time.
// eslint-disable-next-line @typescript-eslint/no-unsafe-argument
await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
