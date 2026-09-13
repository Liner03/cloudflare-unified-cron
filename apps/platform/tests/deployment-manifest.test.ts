import { existsSync, readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { TARGETS } from "../src/targets.manifest";

const configSchema = z.object({
  triggers: z.object({ crons: z.array(z.string()) }),
  services: z.array(
    z.object({
      binding: z.string(),
      service: z.string(),
      entrypoint: z.string(),
    }),
  ),
  queues: z.object({
    producers: z.array(z.object({ binding: z.string(), queue: z.string() })),
    consumers: z.array(
      z.object({ queue: z.string(), max_batch_size: z.number() }),
    ),
  }),
  vars: z.object({ DISPATCH_QUEUE_NAME: z.string() }),
});

const packageSchema = z.object({
  engines: z.object({ node: z.string() }),
  scripts: z.object({ "db:migrate:remote": z.string() }),
});

const workerPackageSchema = z.object({
  scripts: z.object({ "db:migrate:remote": z.string() }),
});

describe("deployment manifest", () => {
  it("keeps exactly one production Cron and matching Service Bindings", () => {
    const source = readFileSync(
      new URL("../wrangler.jsonc", import.meta.url),
      "utf8",
    );
    const config = configSchema.parse(
      JSON.parse(source.replace(/,\s*([}\]])/g, "$1")),
    );
    expect(config.triggers.crons).toEqual(["* * * * *"]);
    for (const target of TARGETS) {
      expect(config.services).toContainEqual({
        binding: target.binding,
        service: target.service,
        entrypoint: target.entrypoint,
      });
    }
    expect(config.queues.producers).toEqual([
      { binding: "DISPATCH_QUEUE", queue: "unified-cron-dispatch" },
    ]);
    expect(config.queues.consumers).toEqual([
      expect.objectContaining({
        queue: "unified-cron-dispatch",
        max_batch_size: 1,
      }),
    ]);
    expect(config.vars.DISPATCH_QUEUE_NAME).toBe("unified-cron-dispatch");
    expect(
      new Set(
        TARGETS.filter((target) => target.delivery).map(
          (target) => `${target.delivery!.binding}:${target.delivery!.queue}`,
        ),
      ),
    ).toEqual(new Set(["DISPATCH_QUEUE:unified-cron-dispatch"]));
  });

  it("keeps the Queue consumer guard equal to the actual configured Queue", () => {
    const source = readFileSync(
      new URL(
        "../../../examples/worker-data/wrangler.queue.local.jsonc",
        import.meta.url,
      ),
      "utf8",
    );
    const config = z
      .object({
        queues: z.object({
          consumers: z.array(z.object({ queue: z.string() })).length(1),
        }),
        services: z.array(
          z.object({ binding: z.string(), service: z.string() }),
        ),
        vars: z.object({ TRIGGER_QUEUE_NAME: z.string() }),
      })
      .parse(JSON.parse(source.replace(/,\s*([}\]])/g, "$1")));

    expect(config.vars.TRIGGER_QUEUE_NAME).toBe(
      config.queues.consumers[0]?.queue,
    );
    expect(config.services).toContainEqual({
      binding: "CRON_PLATFORM",
      service: "unified-cron-platform-local",
    });
  });

  it("keeps the idempotent SQL sync aligned with target ids and revisions", () => {
    const sql = readFileSync(
      new URL("../seed/targets.sql", import.meta.url),
      "utf8",
    );
    for (const target of TARGETS) {
      expect(sql).toContain(`'${target.id}'`);
      expect(sql).toContain(`'${target.manifestRevision}'`);
    }
    expect(sql).toContain("ON CONFLICT(id) DO UPDATE");
  });

  it("writes JSON booleans in local demo execution snapshots", () => {
    const sql = readFileSync(
      new URL("../seed/demo.sql", import.meta.url),
      "utf8",
    );
    expect(sql).toContain("'targetActionIdempotent', json('true')");
    expect(sql).not.toContain("'targetActionIdempotent', true");
  });

  it("requires the documented Node.js 24 runtime", () => {
    const rootPackage = packageSchema.parse(
      JSON.parse(
        readFileSync(new URL("../../../package.json", import.meta.url), "utf8"),
      ),
    );
    expect(rootPackage.engines.node).toBe(">=24");
  });

  it("keeps every documented Wrangler config path resolvable", () => {
    const repositoryRoot = new URL("../../../", import.meta.url);
    const readme = readFileSync(new URL("README.md", repositoryRoot), "utf8");
    const paths = Array.from(
      readme.matchAll(/`((?:apps|examples)\/[^`]*wrangler\.jsonc)`/g),
      (match) => match[1],
    ).filter((path): path is string => path !== undefined);

    expect(paths.length).toBeGreaterThan(0);
    for (const path of paths) {
      expect(existsSync(new URL(path, repositoryRoot)), path).toBe(true);
    }
  });

  it("publishes an LLM-readable index of the real API surface", () => {
    const source = readFileSync(
      new URL("../../web/public/llms.txt", import.meta.url),
      "utf8",
    );
    expect(source).toMatch(/^# Cloudflare Unified Cron Platform\n\n> /);
    for (const path of [
      "/api/v1/auth/session",
      "/api/v1/registration",
      "/api/v1/overview",
      "/api/v1/schedules",
      "/api/v1/targets",
      "/api/v1/executions",
      "/api/v1/audit-events",
      "/api/v1/system",
      "/api/v1/success-rates",
      "/api/v1/registration-tokens",
    ]) {
      expect(source, path).toContain(path);
    }
    expect(source).not.toMatch(/(?:ghp_|gho_|ucrt_)[A-Za-z0-9_-]{20,}/);
    expect(source).not.toContain("ADMIN_PASSWORD_HASH=");
  });

  it("migrates both production D1 databases from the root command", () => {
    const repositoryRoot = new URL("../../../", import.meta.url);
    const rootPackage = packageSchema.parse(
      JSON.parse(readFileSync(new URL("package.json", repositoryRoot), "utf8")),
    );
    const workerPackage = workerPackageSchema.parse(
      JSON.parse(
        readFileSync(
          new URL("examples/worker-data/package.json", repositoryRoot),
          "utf8",
        ),
      ),
    );

    expect(rootPackage.scripts["db:migrate:remote"]).toContain(
      "@unified-cron/example-worker-data db:migrate:remote",
    );
    expect(workerPackage.scripts["db:migrate:remote"]).toBe(
      "wrangler d1 migrations apply BUSINESS_DB --remote --config wrangler.jsonc",
    );
  });

  it("keeps D1 SQL behind repository interfaces", () => {
    const sourceRoot = fileURLToPath(new URL("../src", import.meta.url));
    const offenders = sourceFiles(sourceRoot).filter((path) => {
      if (path.includes("/infrastructure/d1/")) return false;
      const source = readFileSync(path, "utf8");
      return source.includes(".prepare(") || source.includes(".batch(");
    });
    expect(offenders).toEqual([]);
  });

  it("keeps HTTP transport dependencies out of D1 repositories", () => {
    const d1Root = fileURLToPath(
      new URL("../src/infrastructure/d1", import.meta.url),
    );
    const offenders = sourceFiles(d1Root).filter((path) => {
      const source = readFileSync(path, "utf8");
      return (
        /from ["']hono["']/.test(source) ||
        /from ["']\.\.\/\.\.\/api\//.test(source) ||
        /\b(?:new )?Response(?:\.json)?\b/.test(source)
      );
    });
    expect(offenders).toEqual([]);
  });
});

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = `${directory}/${entry.name}`;
    return entry.isDirectory()
      ? sourceFiles(path)
      : entry.isFile() && path.endsWith(".ts")
        ? [path]
        : [];
  });
}
