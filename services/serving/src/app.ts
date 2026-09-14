import express, { type Express } from "express";
import { dbHealthy } from "./db/pool.js";
import { errorMiddleware } from "./http.js";
import { accountRouter } from "./routes/account.js";
import { feedRouter } from "./routes/feed.js";

const VERSION = "0.1.0";

/** Built as a function so tests can run it on an ephemeral port. */
export function createApp(): Express {
  const app = express();
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

  app.use("/v1", feedRouter);
  app.use("/v1", accountRouter);

  app.use(errorMiddleware);
  return app;
}
