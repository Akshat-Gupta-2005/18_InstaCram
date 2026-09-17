/**
 * Signed session tokens for AUTH_MODE=dev-login.
 *
 * Deliberately small: a JSON payload and an HMAC-SHA256 over it, using only
 * node:crypto. It is a stand-in until Firebase ID tokens replace it, so it has to
 * be correct rather than featureful - which here means the signature is checked in
 * constant time, the expiry is enforced, and anything malformed is simply invalid.
 *
 *   v1.<base64url(payload)>.<base64url(hmac)>
 */
import { createHmac, timingSafeEqual } from "node:crypto";

export interface TokenClaims {
  /** The identity. Stored as account.firebase_uid, prefixed "dev:". */
  sub: string;
  /** Expiry, epoch milliseconds. */
  exp: number;
}

/** Shorter secrets are refused: HMAC is only as strong as its key. */
export const MIN_SECRET_LENGTH = 32;

const VERSION = "v1";

export function signToken(sub: string, secret: string, ttlMs: number, now = Date.now()): string {
  assertSecret(secret);
  const payload = base64url(JSON.stringify({ sub, exp: now + ttlMs } satisfies TokenClaims));
  return `${VERSION}.${payload}.${sign(`${VERSION}.${payload}`, secret)}`;
}

/** The claims, or null for anything that is not a valid, unexpired token. */
export function verifyToken(token: string, secret: string, now = Date.now()): TokenClaims | null {
  assertSecret(secret);
  const parts = token.split(".");
  if (parts.length !== 3 || parts[0] !== VERSION) return null;
  const [version, payload, signature] = parts as [string, string, string];

  const expected = Buffer.from(sign(`${version}.${payload}`, secret));
  const given = Buffer.from(signature);
  // timingSafeEqual throws on unequal lengths, so compare lengths first; a length
  // mismatch leaks nothing an attacker does not already know.
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;

  let claims: unknown;
  try {
    claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (
    typeof claims !== "object" ||
    claims === null ||
    typeof (claims as TokenClaims).sub !== "string" ||
    typeof (claims as TokenClaims).exp !== "number"
  ) {
    return null;
  }
  const { sub, exp } = claims as TokenClaims;
  if (sub === "" || exp <= now) return null;
  return { sub, exp };
}

function sign(data: string, secret: string): string {
  return createHmac("sha256", secret).update(data).digest("base64url");
}

function base64url(text: string): string {
  return Buffer.from(text, "utf8").toString("base64url");
}

function assertSecret(secret: string): void {
  if (secret.length < MIN_SECRET_LENGTH) {
    throw new Error(`AUTH_TOKEN_SECRET must be at least ${MIN_SECRET_LENGTH} characters`);
  }
}
