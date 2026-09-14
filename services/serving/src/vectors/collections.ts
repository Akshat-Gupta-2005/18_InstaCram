/**
 * The two Qdrant collections, and the code that creates them.
 *
 * They are separate on purpose. Topic-name vectors are written once per topic and
 * read on every field request; scroll-content vectors are written per card and
 * read by nothing in v1. Merging them would tie a hot dedup path to a cold search
 * index (BUILD-PLAN §6.7).
 *
 * Vector size is fixed by the chosen embedding model and CANNOT be changed after a
 * collection exists. Changing models means recreating the collection and
 * re-embedding everything — which is what the `reindex` command is for.
 */
import { config } from "../config.js";

export const TOPIC_NAME_COLLECTION = "topic_names";
export const SCROLL_CONTENT_COLLECTION = "scroll_contents";

interface CollectionSpec {
  name: string;
  purpose: string;
}

const collections: CollectionSpec[] = [
  {
    name: TOPIC_NAME_COLLECTION,
    purpose: "dedup: is this candidate a topic we already have?",
  },
  {
    name: SCROLL_CONTENT_COLLECTION,
    purpose: "semantic search and future 'more like this'; nothing reads it in v1",
  },
];

async function qdrant(path: string, init?: RequestInit): Promise<Response> {
  return fetch(`${config.qdrantUrl}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    signal: AbortSignal.timeout(30_000),
  });
}

async function exists(name: string): Promise<boolean> {
  const res = await qdrant(`/collections/${name}`);
  if (res.status === 404) return false;
  if (!res.ok) throw new Error(`qdrant ${res.status} checking ${name}`);
  return true;
}

/**
 * Creates whatever is missing and leaves what is there alone. Safe to run on every
 * start: it never drops or alters an existing collection, because doing so would
 * silently discard every vector in it.
 */
export async function ensureCollections(): Promise<string[]> {
  const created: string[] = [];

  for (const collection of collections) {
    if (await exists(collection.name)) continue;

    const res = await qdrant(`/collections/${collection.name}`, {
      method: "PUT",
      body: JSON.stringify({
        vectors: {
          size: config.embeddingDimensions,
          // Cosine, because the threshold was calibrated on cosine similarity.
          // A different metric would make that number meaningless.
          distance: "Cosine",
        },
      }),
    });
    if (!res.ok) {
      throw new Error(`qdrant ${res.status} creating ${collection.name}: ${await res.text()}`);
    }
    created.push(collection.name);
  }

  return created;
}

export async function collectionInfo(
  name: string,
): Promise<{ points: number; size: number; distance: string } | null> {
  const res = await qdrant(`/collections/${name}`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`qdrant ${res.status} reading ${name}`);

  const body = (await res.json()) as {
    result?: {
      points_count?: number;
      config?: { params?: { vectors?: { size?: number; distance?: string } } };
    };
  };
  const vectors = body.result?.config?.params?.vectors;
  return {
    points: body.result?.points_count ?? 0,
    size: vectors?.size ?? 0,
    distance: vectors?.distance ?? "?",
  };
}
