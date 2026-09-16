import "./env.js";
import { createApp } from "./app.js";
import { config } from "./config.js";
import { embed } from "./embeddings/client.js";
import { productionExpansionDeps, runExpansionWorker } from "./expansion/worker.js";
import { searchTopicNames } from "./vectors/topicIndex.js";

createApp().listen(config.port, () => {
  console.log(`serving listening on :${config.port}`);
});

if (config.expansionWorker) {
  const controller = new AbortController();
  for (const signal of ["SIGTERM", "SIGINT"] as const) {
    process.once(signal, () => controller.abort());
  }

  void runExpansionWorker(
    {
      ...productionExpansionDeps({
        embed: (texts) => embed(texts),
        search: (vector, limit) => searchTopicNames(vector, limit),
        threshold: config.topicMatchThreshold,
      }),
      maxAttempts: config.expansionMaxAttempts,
      baseBackoffMs: config.expansionBaseBackoffMs,
      staleMs: config.expansionStaleMs,
    },
    config.expansionPollMs,
    controller.signal,
  );
  console.log("field expansion worker started");
}
