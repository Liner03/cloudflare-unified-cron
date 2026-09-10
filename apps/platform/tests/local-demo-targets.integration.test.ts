import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { TargetRepository } from "../src/infrastructure/d1/target-repository";

describe("local demo targets", () => {
  beforeEach(async () => {
    await env.DB.batch([
      env.DB.prepare("DELETE FROM registered_actions"),
      env.DB.prepare("DELETE FROM registrations"),
      env.DB.prepare("DELETE FROM registration_tokens"),
      env.DB.prepare("DELETE FROM targets"),
      env.DB.prepare(
        `INSERT INTO targets (
           id, label, enabled, manifest_revision, created_at, updated_at
         ) VALUES ('SEARCH', 'Search Worker', 1, 'local-demo-search-v1', 1, 1)`,
      ),
      env.DB.prepare(
        `INSERT INTO targets (
           id, label, enabled, manifest_revision, created_at, updated_at
         ) VALUES ('UNSAFE', 'Unlisted Worker', 1, 'ordinary-v1', 1, 1)`,
      ),
    ]);
  });

  it("only exposes marked D1-only targets when explicitly enabled", async () => {
    const repository = new TargetRepository(env.DB);
    const productionView = await repository.list();
    expect(productionView.map((target) => target.id)).not.toContain("SEARCH");

    const localView = await repository.list({ includeLocalDemoTargets: true });
    const search = localView.find((target) => target.id === "SEARCH");
    expect(search).toMatchObject({
      id: "SEARCH",
      label: "Search Worker",
      binding: "DEMO_SEARCH",
      isDemo: true,
    });
    expect(search?.state?.enabled).toBe(1);
    expect(localView.map((target) => target.id)).not.toContain("UNSAFE");
  });
});
