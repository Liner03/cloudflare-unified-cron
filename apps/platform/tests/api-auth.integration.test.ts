import { exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

describe("production Access boundary", () => {
  it("rejects a missing Access assertion", async () => {
    const response = await exports.default.fetch(
      new Request("https://cron.example.com/api/v1/system"),
    );
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "AUTH_REQUIRED" },
    });
  });

  it("rejects a malformed Access assertion instead of trusting header presence", async () => {
    const response = await exports.default.fetch(
      new Request("https://cron.example.com/api/v1/system", {
        headers: { "Cf-Access-Jwt-Assertion": "not-a-signed-jwt" },
      }),
    );
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "AUTH_TOKEN_INVALID" },
    });
  });
});
