import { Router } from "express";
import { credentialsMatch, DEV_IDENTITY_PREFIX, devLoginMisconfiguration } from "../auth/devLogin.js";
import { signToken } from "../auth/tokens.js";
import { config } from "../config.js";
import { ApiError, handler, requireString } from "../http.js";

export const authRouter = Router();

/**
 * Developer login (AUTH_MODE=dev-login): ID + password -> a signed token.
 *
 * A stand-in for real sign-in. When Firebase arrives, the app gets its token from
 * Firebase (email/password or Google) instead of from here, and this route goes
 * away; the API's side of the contract - a bearer token on every request - does
 * not change.
 *
 * Not rate-limited. Acceptable only because dev-login is for a stack on the
 * developer's own machine; it is one of the reasons this mode must be replaced
 * before anything is reachable from a network.
 */
authRouter.post(
  "/auth/login",
  handler(async (req, res) => {
    const problem = devLoginMisconfiguration();
    if (problem) throw new ApiError(501, "login_not_available", problem);

    const body = req.body as { id?: unknown; password?: unknown };
    const id = requireString(body.id, "id", 100);
    const password = requireString(body.password, "password", 200);

    if (!credentialsMatch(id, password)) {
      // One message for both fields: saying which was wrong halves the guessing.
      throw new ApiError(401, "invalid_credentials", "ID or password is incorrect");
    }

    const ttlMs = config.authTokenTtlHours * 60 * 60 * 1000;
    const token = signToken(`${DEV_IDENTITY_PREFIX}${config.devLoginId}`, config.authTokenSecret, ttlMs);
    res.json({ token, expires_at: new Date(Date.now() + ttlMs).toISOString() });
  }),
);
