/**
 * The self-hosted embedding server (text-embeddings-inference). This is the
 * highest-volume model call in the system — roughly 20 candidate topics on every
 * field request — which is why it runs locally rather than through a hosted API.
 */
const defaultUrl = process.env.EMBEDDINGS_URL ?? "http://localhost:8081";

/** The server refuses larger batches (max_client_batch_size). */
const BATCH = 32;

export async function embed(
  texts: string[],
  baseUrl: string = defaultUrl,
  timeoutMs = 600_000,
): Promise<number[][]> {
  const out: number[][] = [];

  for (let i = 0; i < texts.length; i += BATCH) {
    const chunk = texts.slice(i, i + BATCH);
    const res = await fetch(`${baseUrl}/embed`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ inputs: chunk }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) {
      throw new Error(`embeddings ${res.status}: ${(await res.text()).slice(0, 300)}`);
    }
    out.push(...((await res.json()) as number[][]));
  }

  return out;
}

export async function embeddingInfo(
  baseUrl: string = defaultUrl,
): Promise<{ model_id: string; max_input_length: number }> {
  const res = await fetch(`${baseUrl}/info`, { signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`embeddings /info ${res.status}`);
  return (await res.json()) as { model_id: string; max_input_length: number };
}

/**
 * Cosine similarity. The server returns normalised vectors, but normalising here
 * too costs nothing and means a change of server cannot silently skew every score.
 */
export function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    dot += x * y;
    na += x * x;
    nb += y * y;
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}
