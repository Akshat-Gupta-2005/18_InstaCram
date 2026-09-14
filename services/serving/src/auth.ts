import type { RequestHandler } from "express";
import { config } from "./config.js";
import { ApiError } from "./http.js";
import { findOrCreateAccount } from "./repo/accounts.js";

declare module "express-serve-static-core" {
  interface Request {
    accountId: string;
  }
}

/**
 * Resolves the caller's account.
 *
 * DEV MODE TRUSTS THE TOKEN AS THE IDENTITY. `Authorization: Bearer alice` is
 * the account with firebase_uid "alice", created on first use. It exists only so
 * the feed and account paths could be built and tested before Firebase
 * service-account credentials existed, and it must never run outside local
 * development. Firebase verification (task 2b.1) refuses rather than pretending.
 */
export const requireAccount: RequestHandler = (req, _res, next) => {
  const header = req.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";

  if (token === "") {
    next(new ApiError(401, "unauthenticated", "missing bearer token"));
    return;
  }

  if (config.authMode !== "dev") {
    next(
      new ApiError(
        501,
        "auth_not_configured",
        "Firebase token verification is not wired up yet; it needs service-account credentials",
      ),
    );
    return;
  }

  findOrCreateAccount(token, `${token}@dev.local`)
    .then((account) => {
      req.accountId = account.id;
      next();
    })
    .catch(next);
};
