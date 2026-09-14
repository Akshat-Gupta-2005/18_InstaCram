/**
 * Calls the LiteLLM gateway, which is the only thing in the system that knows
 * which model is actually running. Nothing here names a provider: swapping to a
 * hosted model is an edit to services/llm-gateway/config.yaml.
 */
const gatewayUrl = process.env.LLM_GATEWAY_URL ?? "http://localhost:4000";

export interface CompleteOptions {
  maxTokens?: number;
  /** Local inference is slow, and the first call after a model loads is slower. */
  timeoutMs?: number;
  model?: string;
  /**
   * Ask the runtime to constrain decoding to valid JSON. Asking for JSON in the
   * prompt alone is not enough: a first calibration run lost 2 of 8 fields to
   * "Bad control character in string literal" and "Expected ':' after property
   * name" — the model was free-styling the syntax.
   */
  json?: boolean;
}

export async function complete(prompt: string, opts: CompleteOptions = {}): Promise<string> {
  const { maxTokens = 1200, timeoutMs = 600_000, model = "default", json = false } = opts;

  const res = await fetch(`${gatewayUrl}/v1/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      messages: [{ role: "user", content: prompt }],
      max_tokens: maxTokens,
      ...(json ? { response_format: { type: "json_object" } } : {}),
    }),
    signal: AbortSignal.timeout(timeoutMs),
  });

  if (!res.ok) {
    throw new Error(`llm gateway ${res.status}: ${(await res.text()).slice(0, 300)}`);
  }

  const body = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  const content = body.choices?.[0]?.message?.content;
  if (typeof content !== "string" || content.trim() === "") {
    // An empty reply is what a reasoning model returns when its thinking has
    // consumed the whole token budget (P23). Fail loudly rather than return "".
    throw new Error("llm gateway returned no content");
  }
  return content;
}

/**
 * Models wrap JSON in prose or code fences however much you ask them not to, so
 * the parsing is forgiving about the wrapper and strict about the content.
 */
/**
 * Escapes raw control characters that appear INSIDE string literals. A literal
 * newline in a JSON string is invalid, and it is the single most common way a
 * model's otherwise-fine JSON fails to parse. Text outside strings is untouched,
 * so formatting newlines between fields still work.
 */
function escapeControlCharsInStrings(text: string): string {
  let out = "";
  let inString = false;
  let escaped = false;

  for (const ch of text) {
    if (escaped) {
      out += ch;
      escaped = false;
      continue;
    }
    if (ch === "\\" && inString) {
      out += ch;
      escaped = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      out += ch;
      continue;
    }
    if (inString && ch < " ") {
      out += ch === "\n" ? "\\n" : ch === "\r" ? "\\r" : ch === "\t" ? "\\t" : "";
      continue;
    }
    out += ch;
  }

  return out;
}

export function extractJson<T>(raw: string): T {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(raw);
  const candidate = (fenced?.[1] ?? raw).trim();

  const attempts = [
    candidate,
    escapeControlCharsInStrings(candidate),
    // The outermost braces, which survives a leading sentence of prose.
    (() => {
      const first = candidate.indexOf("{");
      const last = candidate.lastIndexOf("}");
      return first === -1 || last <= first
        ? ""
        : escapeControlCharsInStrings(candidate.slice(first, last + 1));
    })(),
  ];

  for (const attempt of attempts) {
    if (attempt === "") continue;
    try {
      return JSON.parse(attempt) as T;
    } catch {
      // try the next repair
    }
  }

  throw new Error(`model did not return usable JSON: ${candidate.slice(0, 200)}`);
}

/** Always asks the runtime for JSON mode; the prompt alone is not enough. */
export async function completeJson<T>(prompt: string, opts: CompleteOptions = {}): Promise<T> {
  return extractJson<T>(await complete(prompt, { ...opts, json: true }));
}
