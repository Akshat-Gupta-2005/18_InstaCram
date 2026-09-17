import type { RequestHandler } from "express";
import { DEV_IDENTITY_PREFIX, devLoginMisconfiguration } from "./auth/devLogin.js";
import { verifyToken } from "./auth/tokens.js";
import { config } from "./config.js";
import { ApiError } from "./http.js";
import { findOrCreateAccount } from "./repo/accounts.js";

declare module "express-serve-static-core" {
  interface Request {
    accountId: string;
  }
}

/**
 * Resolves the caller's account. How the token is checked depends on AUTH_MODE
 * (see config.ts):
 *
 *   dev        TRUSTS THE TOKEN AS THE IDENTITY. `Bearer alice` is the account
 *              "alice", created on first use. For the test suite only.
 *   dev-login  the token must be one issued by POST /v1/auth/login and must
 *              verify; a guessed or edited token is refused.
 *   firebase   not wired yet (task 2b.1). Refuses rather than pretending.
 *
 * When Google sign-in arrives through Firebase, it becomes another branch here
 * that yields an identity - nothing downstream of this function changes.
 */
export const requireAccount: RequestHandler = (req, _res, next) => {
  const header = req.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";

  if (token === "") {
    next(new ApiError(401, "unauthenticated", "missing bearer token"));
    return;
  }

  let identity: string;
  let email: string;

  if (config.authMode === "dev") {
    identity = token;
    email = `${token}@dev.local`;
  } else if (config.authMode === "dev-login") {
    const problem = devLoginMisconfiguration();
    if (problem) {
      next(new ApiError(501, "auth_not_configured", problem));
      return;
    }
    const claims = verifyToken(token, config.authTokenSecret);
    if (!claims) {
      next(new ApiError(401, "invalid_token", "token is invalid or expired; log in again"));
      return;
    }
    identity = claims.sub;
    email = `${claims.sub.slice(DEV_IDENTITY_PREFIX.length)}@dev.local`;
  } else {
    next(
      new ApiError(
        501,
        "auth_not_configured",
        "Firebase token verification is not wired up yet; it needs service-account credentials",
      ),
    );
    return;
  }

  findOrCreateAccount(identity, email)
    .then((account) => {
      req.accountId = account.id;
      next();
    })
    .catch(next);
};
