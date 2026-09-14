/**
 * Creates the Qdrant collections if they are missing, then prints what exists.
 *
 * Safe to run repeatedly: it never drops or alters a collection that is already
 * there, because that would silently discard every vector in it. Rebuilding after
 * a model change is `reindex`'s job, not this one's.
 */
import "dotenv/config";
import { config } from "../config.js";
import {
  collectionInfo,
  ensureCollections,
  SCROLL_CONTENT_COLLECTION,
  TOPIC_NAME_COLLECTION,
} from "./collections.js";

async function main(): Promise<void> {
  console.log(`qdrant:     ${config.qdrantUrl}`);
  console.log(`dimensions: ${config.embeddingDimensions} (fixed by the chosen embedding model)`);
  console.log(`threshold:  ${config.topicMatchThreshold} (calibrated, see calibration/)\n`);

  const created = await ensureCollections();
  console.log(created.length === 0 ? "no collections created" : `created: ${created.join(", ")}`);

  for (const name of [TOPIC_NAME_COLLECTION, SCROLL_CONTENT_COLLECTION]) {
    const info = await collectionInfo(name);
    console.log(
      info === null
        ? `  ${name}: MISSING`
        : `  ${name}: ${info.size} dims, ${info.distance}, ${info.points} points`,
    );
  }
}

main().catch((err: unknown) => {
  console.error("ENSURE COLLECTIONS FAILED:", err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
