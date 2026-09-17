import express, { type Express } from "express";
import { cors } from "./cors.js";
import { dbHealthy } from "./db/pool.js";
import { errorMiddleware } from "./http.js";
import { accountRouter } from "./routes/account.js";
import { authRouter } from "./routes/auth.js";
import { feedRouter } from "./routes/feed.js";

const VERSION = "0.1.0";

/** Built as a function so tests can run it on an ephemeral port. */
export function createApp(): Express {
  const app = express();
  // Before everything else, so preflight requests are answered before any route
  // or auth check can reject them.
  app.use(cors);
  app.use(express.json({ limit: "64kb" }));

  app.get("/health", (_req, res) => {
    void dbHealthy().then((db) => {
      res.status(db ? 200 : 503).json({
        status: db ? "ok" : "degraded",
        service: "serving",
        db: db ? "ok" : "unreachable",
        version: VERSION,
      });
    });
  });

  // The auth router first: login must be reachable without a token, and the feed
  // and account routers require one for every route they own.
  app.use("/v1", authRouter);
  app.use("/v1", feedRouter);
  app.use("/v1", accountRouter);

  app.use(errorMiddleware);
  return app;
}
