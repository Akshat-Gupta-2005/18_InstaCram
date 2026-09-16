/**
 * Claims field expansions and turns each into topics: candidates -> resolve.
 *
 * This is where "cache-then-generate" actually happens for a field. The feed
 * never calls it; the feed only enqueues and reads. That separation is what keeps
 * polling from re-running candidate generation (P16), and it is enforced
 * structurally rather than by a comment: nothing reachable from a request handler
 * calls `expandOnce`.
 *
 * PARTIAL FAILURE. Candidates resolve one at a time, each in its own transaction,
 * so candidate 7 failing leaves 1-6 committed. That is deliberately treated as
 * success-with-errors rather than retried: regenerating would cost another 32-54s
 * of LLM time AND produce a different candidate list, because generation is not
 * deterministic. Only when EVERY candidate fails - the signature of the embedding
 * server or Qdrant being down, not of one bad candidate - is the expansion
 * retried as a whole.
 */
import { generateCandidates, type Candidate } from "../topics/candidates.js";
import { resolveCandidate, type ResolveDeps } from "../topics/resolve.js";
import {
  claimExpansion,
  completeExpansion,
  failExpansion,
  reapStaleExpansions,
  type ExpansionCounts,
  type ExpansionJob,
} from "./queue.js";

export interface ExpansionDeps {
  generate: (field: string, exclude: string[]) => Promise<Candidate[]>;
  resolve: ResolveDeps;
  maxAttempts: number;
  baseBackoffMs: number;
  staleMs: number;
}

export type ExpansionResult =
  | { kind: "idle" }
  | { kind: "done"; job: ExpansionJob; counts: ExpansionCounts }
  | { kind: "retrying" | "failed"; job: ExpansionJob; error: string };

/** Claims and runs at most one expansion. Returns what happened, for tests and logs. */
export async function expandOnce(deps: ExpansionDeps): Promise<ExpansionResult> {
  await reapStaleExpansions(deps.staleMs);

  const job = await claimExpansion();
  if (!job) return { kind: "idle" };

  let candidates: Candidate[];
  try {
    // 'more' (task 5.6) will pass the field's existing topic names here so the
    // generator aims deeper instead of re-proposing what exists. An initial
    // expansion has nothing to exclude.
    candidates = await deps.generate(job.fieldName, []);
  } catch (err) {
    const error = `candidate generation failed: ${describe(err)}`;
    return { kind: await failExpansion(job, error, deps.maxAttempts, deps.baseBackoffMs), job, error };
  }

  const counts: ExpansionCounts = {
    candidates: candidates.length,
    reused: 0,
    joined: 0,
    requeued: 0,
    created: 0,
    resolveErrors: 0,
  };
  let firstError: string | null = null;

  for (const candidate of candidates) {
    try {
      const r = await resolveCandidate(job.fieldId, candidate, deps.resolve);
      counts[r.outcome]++;
    } catch (err) {
      counts.resolveErrors++;
      firstError ??= `resolving ${JSON.stringify(candidate.name)}: ${describe(err)}`;
    }
  }

  if (candidates.length > 0 && counts.resolveErrors === candidates.length) {
    const error = `every candidate failed to resolve - ${firstError}`;
    return { kind: await failExpansion(job, error, deps.maxAttempts, deps.baseBackoffMs), job, error };
  }

  await completeExpansion(job.id, counts);
  return { kind: "done", job, counts };
}

/**
 * The loop run inside the serving process. Drains everything claimable, then
 * sleeps. Errors from the loop's own machinery (Postgres unreachable) are logged
 * and retried on the next tick rather than crashing serving: the feed must keep
 * answering from cache while generation is unavailable (API contract, 503 rules).
 */
export async function runExpansionWorker(
  deps: ExpansionDeps,
  pollMs: number,
  signal: AbortSignal,
): Promise<void> {
  while (!signal.aborted) {
    try {
      let result: ExpansionResult;
      do {
        result = await expandOnce(deps);
        if (result.kind === "done") {
          const c = result.counts;
          console.log(
            `expansion ${result.job.id} (${result.job.fieldName}): ${c.candidates} candidates -> ` +
              `${c.reused} reused, ${c.joined} joined, ${c.requeued} requeued, ${c.created} created` +
              (c.resolveErrors ? `, ${c.resolveErrors} failed` : ""),
          );
        } else if (result.kind !== "idle") {
          console.warn(`expansion ${result.job.id} (${result.job.fieldName}) ${result.kind}: ${result.error}`);
        }
      } while (result.kind !== "idle" && !signal.aborted);
    } catch (err) {
      console.error(`expansion worker error: ${describe(err)}`);
    }
    await sleep(pollMs, signal);
  }
}

export function productionExpansionDeps(resolve: ResolveDeps): Pick<ExpansionDeps, "generate" | "resolve"> {
  return { generate: generateCandidates, resolve };
}

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const t = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => {
      clearTimeout(t);
      resolve();
    }, { once: true });
  });
}
