import {
  SignJWT,
  createLocalJWKSet,
  exportJWK,
  generateKeyPair,
  type GenerateKeyPairResult,
  type JWTVerifyGetKey,
} from "jose";
import { beforeAll, describe, expect, it } from "vitest";
import { ApiError } from "../src/api/errors";
import { verifyAccessIdentity } from "../src/infrastructure/auth/access";

const issuer = "https://unit-test.cloudflareaccess.com";
const audience = "unit-test-audience";
let keys: GenerateKeyPairResult;
let getKey: JWTVerifyGetKey;

beforeAll(async () => {
  keys = await generateKeyPair("RS256");
  const publicJwk = await exportJWK(keys.publicKey);
  publicJwk.alg = "RS256";
  publicJwk.kid = "test-key";
  getKey = createLocalJWKSet({ keys: [publicJwk] });
});

describe("Access JWT verification", () => {
  it("accepts a valid signed token and returns its trusted actor", async () => {
    const token = await sign({ issuer, audience, expiration: "5m" });
    await expect(
      verifyAccessIdentity(token, getKey, issuer, audience),
    ).resolves.toBe("admin@example.com");
  });

  it.each([
    ["wrong issuer", "https://other.cloudflareaccess.com", audience, "5m"],
    ["wrong audience", issuer, "other-audience", "5m"],
    ["expired", issuer, audience, -60],
  ] as const)(
    "rejects %s",
    async (_label, tokenIssuer, tokenAudience, expiration) => {
      const token = await sign({
        issuer: tokenIssuer,
        audience: tokenAudience,
        expiration,
      });
      await expect(
        verifyAccessIdentity(token, getKey, issuer, audience),
      ).rejects.toMatchObject({
        status: 401,
        code: "AUTH_TOKEN_INVALID",
      } satisfies Partial<ApiError>);
    },
  );

  it("rejects a valid token without a trusted actor claim", async () => {
    const token = await new SignJWT({})
      .setProtectedHeader({ alg: "RS256", kid: "test-key" })
      .setIssuer(issuer)
      .setAudience(audience)
      .setIssuedAt()
      .setExpirationTime("5m")
      .sign(keys.privateKey);
    await expect(
      verifyAccessIdentity(token, getKey, issuer, audience),
    ).rejects.toMatchObject({
      status: 401,
      code: "AUTH_IDENTITY_MISSING",
    } satisfies Partial<ApiError>);
  });
});

async function sign(input: {
  issuer: string;
  audience: string;
  expiration: string | number;
}): Promise<string> {
  return new SignJWT({ email: "admin@example.com" })
    .setProtectedHeader({ alg: "RS256", kid: "test-key" })
    .setIssuer(input.issuer)
    .setAudience(input.audience)
    .setIssuedAt()
    .setExpirationTime(input.expiration)
    .sign(keys.privateKey);
}
