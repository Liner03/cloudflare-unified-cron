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
          serviceBindings: Object.fromEntries(
            [0, 1, 2].map((i) => [
              `MULTI_RPC_${i}`,
              { name: `multi-site-${i}`, entrypoint: "CronEntrypoint" },
            ]),
          ),
          queueProducers: Object.fromEntries(
            [0, 1, 2].map((i) => [`REAL_QUEUE_${i}`, `multi-queue-${i}`]),
          ),
          workers: [0, 1, 2].map((i) => ({
            name: `multi-site-${i}`,
            modules: true,
            compatibilityDate: "2026-09-08",
            d1Databases: { STORE: `multi-site-${i}` },
            queueConsumers: {
              [`multi-queue-${i}`]: { maxBatchSize: 1, maxBatchTimeout: 0 },
            },
            script: `
            import { WorkerEntrypoint } from 'cloudflare:workers';
            async function init(env){await env.STORE.prepare('CREATE TABLE IF NOT EXISTS receipts (id TEXT PRIMARY KEY)').run();}
            export class CronEntrypoint extends WorkerEntrypoint {
              async describe(){await init(this.env);const rows=await this.env.STORE.prepare('SELECT id FROM receipts').all();return {protocolVersion:1,actions:[{name:'SITE_${i}',version:1,idempotent:true},...rows.results.map(row=>({name:row.id,version:1,idempotent:true}))]};}
              cron(){return {};}
            }
            export default {fetch(){return new Response('ok')},async queue(batch,env){await init(env);for(const message of batch.messages){if(message.body.targetId!=='SITE_${i}')throw new Error('wrong target');if(message.body.payload.delayMs)await new Promise(resolve=>setTimeout(resolve,Math.min(35000,message.body.payload.delayMs)));await env.STORE.prepare('INSERT INTO receipts(id) VALUES (?) ON CONFLICT DO NOTHING').bind(message.body.deliveryId).run();message.ack();}}};`,
          })),
          bindings: {
            TRIGGER_SIGNING_KEY:
              "local-integration-signing-key-not-for-deployment",
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
