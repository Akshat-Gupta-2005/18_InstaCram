import type { RequestHandler } from "express";
import { config } from "./config.js";

/**
 * CORS for the web build of the app, which is served from its own origin.
 *
 * Hand-written rather than a dependency because the policy is small and should
 * stay visible: only origins listed in CORS_ORIGINS get the headers, a listed
 * origin is echoed back exactly (never "*", which a browser refuses alongside an
 * Authorization header anyway), and preflight requests are answered here. Native
 * apps do not send an Origin header and are unaffected.
 */
export const cors: RequestHandler = (req, res, next) => {
  const origin = req.get("origin");
  if (origin && config.corsOrigins.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
    res.setHeader("Access-Control-Max-Age", "600");
  }
  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }
  next();
};
