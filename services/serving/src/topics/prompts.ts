import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Prompts live in prompts/*.md and are loaded at runtime, so the file that
 * explains an instruction and the text that actually runs can never disagree.
 * Copying the prompt into TypeScript would be less plumbing and would let the two
 * drift silently — and for an LLM agent the prompt IS the behaviour.
 *
 * The image copies prompts/ in and sets PROMPTS_DIR; the fallback resolves the
 * repo's prompts/ when running from source.
 */
const fallbackDir = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..", "prompts");
export const promptsDir = process.env.PROMPTS_DIR ?? fallbackDir;

const cache = new Map<string, string>();

/**
 * Takes the first fenced block after the "## Prompt" heading. The rest of the
 * document is reasoning for humans and must not reach the model.
 */
export async function loadPrompt(file: string): Promise<string> {
  const cached = cache.get(file);
  if (cached !== undefined) return cached;

  const text = await readFile(join(promptsDir, file), "utf8");
  const afterHeading = text.split(/^##\s+Prompt\s*$/m)[1];
  if (afterHeading === undefined) {
    throw new Error(`${file}: no "## Prompt" section`);
  }
  const fenced = /```([\s\S]*?)```/.exec(afterHeading);
  if (!fenced?.[1]) {
    throw new Error(`${file}: no fenced prompt block after "## Prompt"`);
  }

  const prompt = fenced[1].trim();
  cache.set(file, prompt);
  return prompt;
}

/**
 * Minimal templating: {{var}} substitution plus a single {{#if x}}…{{/if}} block,
 * which is all the prompt files use. A template engine would be a dependency
 * bigger than the feature.
 */
export function render(template: string, vars: Record<string, string | string[]>): string {
  let out = template;

  out = out.replace(/\{\{#if (\w+)\}\}([\s\S]*?)\{\{\/if\}\}/g, (_match, name: string, body: string) => {
    const value = vars[name];
    const present = Array.isArray(value) ? value.length > 0 : Boolean(value);
    return present ? body : "";
  });

  for (const [name, value] of Object.entries(vars)) {
    const text = Array.isArray(value) ? value.join(", ") : value;
    out = out.replace(new RegExp(`\\{\\{${name}\\}\\}`, "g"), text);
  }

  return out.trim();
}
