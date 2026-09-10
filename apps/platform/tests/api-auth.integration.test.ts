import { env, exports } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";

describe("local administrator authentication", () => {
  beforeEach(async () => {
    await env.DB.batch([
      env.DB.prepare("DELETE FROM admin_sessions"),
      env.DB.prepare("DELETE FROM admin_login_limits"),
    ]);
  });

  it("fails closed without an Admin Session", async () => {
    const response = await exports.default.fetch(
      new Request("http://localhost/api/v1/system"),
    );
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "AUTH_REQUIRED" },
    });
  });

  it("creates an opaque HttpOnly session for valid local credentials", async () => {
    const response = await login("admin", "test-password");
    expect(response.status).toBe(200);
    expect(response.headers.get("Set-Cookie")).toMatch(
      /^ucp_session=ucas_[A-Za-z0-9_-]{43}; Path=\/; HttpOnly; SameSite=Strict;/,
    );
    await expect(response.json()).resolves.toMatchObject({
      data: { authenticated: true, username: "admin" },
    });
    const stored = await env.DB.prepare(
      "SELECT token_hash FROM admin_sessions",
    ).first<{ token_hash: string }>();
    expect(stored?.token_hash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("uses one generic error for an unknown username or wrong password", async () => {
    for (const [username, password] of [
      ["unknown", "test-password"],
      ["admin", "wrong-password"],
    ] as const) {
      const response = await login(username, password);
      expect(response.status).toBe(401);
      await expect(response.json()).resolves.toMatchObject({
        error: { code: "INVALID_CREDENTIALS" },
      });
    }
  });

  it("temporarily blocks repeated failed logins from one source", async () => {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      expect((await login("admin", "wrong-password")).status).toBe(401);
    }
    const blocked = await login("admin", "test-password");
    expect(blocked.status).toBe(429);
    await expect(blocked.json()).resolves.toMatchObject({
      error: {
        code: "LOGIN_RATE_LIMITED",
      },
    });
  });

  it("reports session state and revokes it on logout", async () => {
    const loggedIn = await login("admin", "test-password");
    const cookie = cookiePair(loggedIn);
    const session = await exports.default.fetch(
      new Request("http://localhost/api/v1/auth/session", {
        headers: { Cookie: cookie },
      }),
    );
    await expect(session.json()).resolves.toMatchObject({
      data: { authenticated: true, username: "admin" },
    });
    const logout = await exports.default.fetch(
      new Request("http://localhost/api/v1/auth/logout", {
        method: "POST",
        headers: {
          Cookie: cookie,
          Origin: "http://localhost:8787",
          "Content-Type": "application/json",
        },
        body: "{}",
      }),
    );
    expect(logout.status).toBe(200);
    const after = await exports.default.fetch(
      new Request("http://localhost/api/v1/auth/session", {
        headers: { Cookie: cookie },
      }),
    );
    await expect(after.json()).resolves.toMatchObject({
      data: { authenticated: false },
    });
  });
});

function login(username: string, password: string): Promise<Response> {
  return exports.default.fetch(
    new Request("http://localhost/api/v1/auth/login", {
      method: "POST",
      headers: {
        Origin: "http://localhost:8787",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ username, password }),
    }),
  );
}

function cookiePair(response: Response): string {
  const cookie = response.headers.get("Set-Cookie")?.split(";", 1)[0];
  if (!cookie) throw new Error("login response did not set a session cookie");
  return cookie;
}
