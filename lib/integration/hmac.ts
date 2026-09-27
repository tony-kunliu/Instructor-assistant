// HMAC-SHA256 request signing for the ACTGDS webhook (see
// docs/integrations/actgds-instructor-assistant-v1.md#transport). Uses the
// Web Crypto API (`crypto.subtle`), available in both the Cloudflare
// Workers runtime and Node's test environment — no Node-only `Buffer`/
// `crypto` module dependency, so this file runs unmodified in either.

function bytesToHex(buffer: ArrayBuffer): string {
  return [...new Uint8Array(buffer)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function hmacSha256Hex(secret: string, message: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(message));
  return bytesToHex(signature);
}

/**
 * The exact bytes signed are `"<unix-seconds>." + <raw request body>` — the body must never be
 * re-serialized between signing and sending (or between receiving and verifying): any change to
 * whitespace/key order changes the bytes and invalidates the signature.
 */
export async function signWebhookBody(secret: string, timestampSeconds: number, rawBody: string): Promise<string> {
  const hex = await hmacSha256Hex(secret, `${timestampSeconds}.${rawBody}`);
  return `v1=${hex}`;
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** For the fake receiver (tests) to verify a request the sender produced — mirrors what the real ACTGDS receiver must do. */
export async function verifyWebhookSignature(secret: string, timestampSeconds: number, rawBody: string, signatureHeader: string): Promise<boolean> {
  const expected = await signWebhookBody(secret, timestampSeconds, rawBody);
  return timingSafeEqual(expected, signatureHeader);
}
