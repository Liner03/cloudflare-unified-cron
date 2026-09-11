import { describe, expect, it } from "vitest";
import {
  enforceMutationRequest,
  isSecureSessionEnvironment,
  verifyConfiguredPassword,
} from "../src/infrastructure/auth/access";

const HASH =
  "pbkdf2-sha256$600000$MDEyMzQ1Njc4OWFiY2RlZg$YVNTOas3Ktj9Bxo0o7TgbDWqVSP6iO1YpNUrQDQGjgA";

describe("local administrator password verification", () => {
  it("uses secure session cookies for staging and production", () => {
    expect(isSecureSessionEnvironment("development")).toBe(false);
    expect(isSecureSessionEnvironment("test")).toBe(false);
    expect(isSecureSessionEnvironment("staging")).toBe(true);
    expect(isSecureSessionEnvironment("production")).toBe(true);
  });

  it("accepts the password represented by the configured PBKDF2 hash", async () => {
    await expect(verifyConfiguredPassword("test-password", HASH)).resolves.toBe(
      true,
    );
  });

  it("rejects a different password", async () => {
    await expect(
      verifyConfiguredPassword("wrong-password", HASH),
    ).resolves.toBe(false);
  });

  it("rejects weak or malformed configuration", async () => {
    await expect(
      verifyConfiguredPassword("test-password", "pbkdf2-sha256$1$bad$bad"),
    ).rejects.toMatchObject({
      status: 503,
      code: "AUTH_CONFIGURATION_INVALID",
    });
  });

  it("keeps production mutation origins exact", () => {
    const request = new Request("https://cron.example.com/api/v1/auth/login", {
      method: "POST",
      headers: {
        Origin: "https://www.cron.example.com",
        "Content-Type": "application/json",
      },
      body: "{}",
    });
    expect(() =>
      enforceMutationRequest(request, {
        APP_ENV: "production",
        PUBLIC_ORIGIN: "https://cron.example.com",
      }),
    ).toThrow(
      expect.objectContaining({ status: 403, code: "ORIGIN_FORBIDDEN" }),
    );
  });
});
