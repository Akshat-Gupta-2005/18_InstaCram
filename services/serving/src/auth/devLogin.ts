/**
 * The developer ID + password check for AUTH_MODE=dev-login.
 *
 * One configured account, from .env, until real sign-in (Firebase: email/password
 * and Google) replaces it. The identity is namespaced "dev:" so it can never
 * collide with a Firebase uid once both exist.
 */
import { createHash, timingSafeEqual } from "node:crypto";
import { config } from "../config.js";
import { MIN_SECRET_LENGTH } from "./tokens.js";

export const DEV_IDENTITY_PREFIX = "dev:";

/** Why dev-login cannot work with the current configuration, or null if it can. */
export function devLoginMisconfiguration(): string | null {
  if (config.authMode !== "dev-login") return "AUTH_MODE is not dev-login";
  if (!config.devLoginId || !config.devLoginPassword) {
    return "DEV_LOGIN_ID and DEV_LOGIN_PASSWORD must both be set";
  }
  if (config.authTokenSecret.length < MIN_SECRET_LENGTH) {
    return `AUTH_TOKEN_SECRET must be at least ${MIN_SECRET_LENGTH} characters`;
  }
  return null;
}

/**
 * Compares both values in constant time. Hashing first gives equal-length inputs,
 * which timingSafeEqual requires, so the comparison reveals neither which field
 * was wrong nor how much of it matched.
 */
export function credentialsMatch(id: string, password: string): boolean {
  const idOk = safeEqual(id, config.devLoginId);
  const passwordOk = safeEqual(password, config.devLoginPassword);
  return idOk && passwordOk;
}

function safeEqual(a: string, b: string): boolean {
  const ha = createHash("sha256").update(a).digest();
  const hb = createHash("sha256").update(b).digest();
  return timingSafeEqual(ha, hb);
}
