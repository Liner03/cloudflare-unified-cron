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
            ["A", "B", "C"].map((id) => [
              `CRON_DATA_${id}`,
              { name: `multi-site-${id}`, entrypoint: "CronEntrypoint" },
            ]),
          ),
          workers: ["A", "B", "C"].map((id) => ({
            name: `multi-site-${id}`,
            modules: true,
            compatibilityDate: "2026-09-08",
            d1Databases: { STORE: `multi-site-${id}` },
            script: `
            import { WorkerEntrypoint } from 'cloudflare:workers';
            async function init(env){await env.STORE.prepare('CREATE TABLE IF NOT EXISTS receipts (id TEXT PRIMARY KEY)').run();}
            export class CronEntrypoint extends WorkerEntrypoint {
              async describe(){await init(this.env);const rows=await this.env.STORE.prepare('SELECT id FROM receipts').all();return {protocolVersion:1,actions:[{name:'probe',version:1,idempotent:true},...rows.results.map(row=>({name:row.id,version:1,idempotent:true}))]};}
              async cron(input){await init(this.env);if(input.targetId!=='DATA_${id}')throw new Error('wrong target');if(input.payload.delayMs)await new Promise(resolve=>setTimeout(resolve,Math.min(35000,input.payload.delayMs)));await this.env.STORE.prepare('INSERT INTO receipts(id) VALUES (?) ON CONFLICT DO NOTHING').bind(input.executionId).run();return {protocolVersion:1,executionId:input.executionId,attemptId:input.attemptId,ok:true,summary:'ok'};}
            }
            export default {fetch(){return new Response('ok')}};`,
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
