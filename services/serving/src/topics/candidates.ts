import { completeJson } from "../llm/client.js";
import { loadPrompt, render } from "./prompts.js";

export interface Candidate {
  name: string;
  /** One sentence, ≤15 words. This exact string is what gets embedded and stored. */
  description: string;
}

/**
 * Field name -> the atomic topics that make it up. Runs in the serving service
 * because it fires on every field request, including pure cache hits.
 *
 * The description is not decoration. On a cache miss it becomes the topic's
 * stored description and is embedded; on every later request it is the query
 * text. Both sides of every similarity comparison therefore come from this one
 * call, which is what makes the scores comparable at all (invariant 9, P9).
 */
export async function generateCandidates(
  field: string,
  exclude: string[] = [],
): Promise<Candidate[]> {
  const template = await loadPrompt("candidate-topics.md");
  const prompt = render(template, { field, exclude });

  const parsed = await completeJson<{ topics?: unknown }>(prompt);
  if (!Array.isArray(parsed.topics)) {
    throw new Error("candidate generator returned no topics array");
  }

  const seen = new Set<string>();
  const candidates: Candidate[] = [];

  for (const raw of parsed.topics) {
    const t = raw as { name?: unknown; description?: unknown };
    if (typeof t.name !== "string" || typeof t.description !== "string") continue;

    const name = t.name.trim();
    const description = t.description.trim();
    if (name === "" || description === "") continue;

    // A model asked for 20 topics will occasionally repeat one; two identical
    // names in one field would become two topic rows for the same concept.
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);

    candidates.push({ name, description });
  }

  return candidates;
}
