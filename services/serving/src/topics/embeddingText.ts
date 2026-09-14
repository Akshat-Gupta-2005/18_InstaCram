/**
 * The exact text that represents a topic in the vector store.
 *
 * This lives in one place on purpose. The same string is embedded when a topic is
 * created and when a later candidate is looked up, and that symmetry is the only
 * reason the similarity scores mean anything (P9). Calibration must use this too:
 * a threshold measured on differently-joined text would not transfer.
 *
 * Changing the format OR the prefix invalidates every stored vector AND the
 * calibrated threshold. Treat it like a schema migration, not a formatting tweak.
 */

/**
 * Some models expect an instruction prefix. The e5 family is trained with
 * "query: " / "passage: " markers and scores noticeably differently without them.
 *
 * Both sides of our comparison are the same kind of text — a topic name and its
 * one-line description — so one prefix is used for both, which keeps the symmetry
 * that makes the scores comparable. It is configuration rather than a constant so
 * the calibration sweep can measure a model the way that model expects to be used,
 * and production can then embed identically.
 */
const prefix = process.env.EMBEDDING_TEXT_PREFIX ?? "";

export function topicEmbeddingText(name: string, description: string): string {
  return `${prefix}${name}: ${description}`;
}
