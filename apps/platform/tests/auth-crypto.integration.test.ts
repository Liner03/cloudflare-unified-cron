import { describe, expect, it } from "vitest";
import { verifyConfiguredPassword } from "../src/infrastructure/auth/access";

const HASH =
  "pbkdf2-sha256$600000$MDEyMzQ1Njc4OWFiY2RlZg$YVNTOas3Ktj9Bxo0o7TgbDWqVSP6iO1YpNUrQDQGjgA";

describe("local administrator password verification", () => {
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
});
