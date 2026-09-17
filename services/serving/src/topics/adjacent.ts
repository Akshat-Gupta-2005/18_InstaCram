import { completeJson } from "../llm/client.js";
import { loadPrompt, render } from "./prompts.js";

/** The end card offers at most this many; the prompt asks for the same. */
export const MAX_SUGGESTIONS = 5;

/**
 * Longer than a search box would hold. The prompt asks for 1-5 words, and a model
 * that returns a sentence instead has not produced a field name.
 */
const MAX_WORDS = 6;
const MAX_CHARS = 60;

/**
 * Field name -> related field names (task 5.7). Runs in the background after an
 * expansion, never while building a page: measured at ~8s on an idle GPU and ~57s
 * while the pipeline is generating (DECISIONS 2026-09-17).
 */
export async function suggestAdjacentFields(field: string): Promise<string[]> {
  const prompt = render(await loadPrompt("adjacent-fields.md"), { field });
  const parsed = await completeJson<{ fields?: unknown }>(prompt, { maxTokens: 300 });
  return cleanSuggestions(field, parsed.fields);
}

/**
 * Strict about what becomes a tappable field name. Everything dropped here would
 * otherwise reach the end card as something a user can tap into a cold start -
 * the field they just finished under another casing, a duplicate, or a sentence.
 */
export function cleanSuggestions(field: string, raw: unknown): string[] {
  if (!Array.isArray(raw)) {
    throw new Error("adjacent-field suggester returned no fields array");
  }

  const own = normalise(field);
  const seen = new Set<string>();
  const out: string[] = [];

  for (const item of raw) {
    if (typeof item !== "string") continue;
    const name = item.trim().replace(/\s+/g, " ");
    const key = normalise(name);
    if (key === "" || key === own || seen.has(key)) continue;
    if (name.length > MAX_CHARS || name.split(" ").length > MAX_WORDS) continue;
    seen.add(key);
    out.push(name);
    if (out.length === MAX_SUGGESTIONS) break;
  }

  return out;
}

/** The same rule as field.name_norm (lower(btrim(name))), so comparisons agree with the database. */
function normalise(name: string): string {
  return name.trim().toLowerCase();
}
