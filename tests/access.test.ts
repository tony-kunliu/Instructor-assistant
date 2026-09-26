import { test } from "node:test";
import assert from "node:assert/strict";
import { SignJWT, exportJWK, generateKeyPair, createLocalJWKSet } from "jose";
import { verifyAccessIdentity } from "../lib/access.ts";

const AUDIENCE = "test-audience";
const ISSUER = "https://test-team.cloudflareaccess.com";

async function setupSignedJwks() {
  const { publicKey, privateKey } = await generateKeyPair("RS256");
  const jwk = await exportJWK(publicKey);
  const jwks = createLocalJWKSet({ keys: [{ ...jwk, kid: "test-key", alg: "RS256", use: "sig" }] });
  return { privateKey, jwks };
}

function requestWithToken(token: string | null): Request {
  const headers = new Headers();
  if (token) headers.set("cf-access-jwt-assertion", token);
  return new Request("https://instructor-assistant.example/", { headers });
}

test("verifyAccessIdentity returns null when there is no Access JWT header (e.g. local dev, or no Access in front)", async () => {
  const { jwks } = await setupSignedJwks();
  const identity = await verifyAccessIdentity(requestWithToken(null), jwks, AUDIENCE, ISSUER);
  assert.equal(identity, null);
});

test("verifyAccessIdentity verifies a correctly signed token and extracts the email claim", async () => {
  const { privateKey, jwks } = await setupSignedJwks();
  const token = await new SignJWT({ email: "Kunliu.work@gmail.com" })
    .setProtectedHeader({ alg: "RS256", kid: "test-key" })
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setExpirationTime("5m")
    .sign(privateKey);

  const identity = await verifyAccessIdentity(requestWithToken(token), jwks, AUDIENCE, ISSUER);
  assert.deepEqual(identity, { email: "Kunliu.work@gmail.com" });
});

test("verifyAccessIdentity rejects a token with the wrong audience (a JWT from a different Access app must not be accepted)", async () => {
  const { privateKey, jwks } = await setupSignedJwks();
  const token = await new SignJWT({ email: "Kunliu.work@gmail.com" })
    .setProtectedHeader({ alg: "RS256", kid: "test-key" })
    .setIssuer(ISSUER)
    .setAudience("some-other-apps-audience")
    .setExpirationTime("5m")
    .sign(privateKey);

  await assert.rejects(() => verifyAccessIdentity(requestWithToken(token), jwks, AUDIENCE, ISSUER));
});

test("verifyAccessIdentity rejects an expired token", async () => {
  const { privateKey, jwks } = await setupSignedJwks();
  const token = await new SignJWT({ email: "Kunliu.work@gmail.com" })
    .setProtectedHeader({ alg: "RS256", kid: "test-key" })
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt(Math.floor(Date.now() / 1000) - 3600)
    .setExpirationTime(Math.floor(Date.now() / 1000) - 1800)
    .sign(privateKey);

  await assert.rejects(() => verifyAccessIdentity(requestWithToken(token), jwks, AUDIENCE, ISSUER));
});

test("verifyAccessIdentity rejects a token signed by a different key (forged/tampered signature)", async () => {
  const { jwks } = await setupSignedJwks();
  const { privateKey: attackerKey } = await generateKeyPair("RS256");
  const forged = await new SignJWT({ email: "Kunliu.work@gmail.com" })
    .setProtectedHeader({ alg: "RS256", kid: "test-key" })
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setExpirationTime("5m")
    .sign(attackerKey);

  await assert.rejects(() => verifyAccessIdentity(requestWithToken(forged), jwks, AUDIENCE, ISSUER));
});

test("verifyAccessIdentity rejects a correctly signed token that has no email claim", async () => {
  const { privateKey, jwks } = await setupSignedJwks();
  const token = await new SignJWT({ sub: "someone" })
    .setProtectedHeader({ alg: "RS256", kid: "test-key" })
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setExpirationTime("5m")
    .sign(privateKey);

  await assert.rejects(() => verifyAccessIdentity(requestWithToken(token), jwks, AUDIENCE, ISSUER), /no email claim/);
});
