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
