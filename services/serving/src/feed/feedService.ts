import { config } from "../config.js";
import {
  enqueueInitialExpansion,
  enqueueMoreExpansion,
  latestExpansion,
  openExpansionExists,
  requeueFailedTopics,
} from "../expansion/queue.js";
import { adjacentFields, findOrCreateField, type Field } from "../repo/fields.js";
import {
  failedTopics,
  pendingTopicCount,
  revisionPage,
  unviewedPage,
  viewedCountInField,
} from "../repo/feed.js";
import type { ExpandResponse, FeedPage } from "../types.js";

/**
 * Assembles one page. The three states the client must keep apart:
 *
 *   cards + !generating + !exhausted  -> a normal page
 *   partial/empty + generating        -> cold start, keep polling
 *   empty + exhausted                 -> the field is finished, show the end card
 *
 * A page may hold fewer cards than asked for, including none, which is what
 * makes a cold field usable instead of a blank wait (P13).
 */
export async function buildFeedPage(
  fieldName: string,
  accountId: string,
  limit: number,
): Promise<FeedPage> {
  const field = await findOrCreateField(fieldName);

  // Enqueue, never run. Candidate generation takes 32-54s, so this request only
  // records that the field is owed an expansion and returns at once. A no-op for
  // any field that already has topics, and for any later poll (see the function),
  // which is what stops polling from re-running candidate generation (P16).
  await enqueueInitialExpansion(field.id);

  const [scrolls, pending, failed, expanding, lastExpansion] = await Promise.all([
    unviewedPage(field.id, accountId, limit),
    pendingTopicCount(field.id),
    failedTopics(field.id),
    openExpansionExists(field.id),
    latestExpansion(field.id),
  ]);

  // An expansion still owed counts as generating. Without it, a brand-new field
  // has no topics while its candidates are produced, reports `exhausted`, and
  // shows the end-of-field card for most of a minute.
  const generating = pending > 0 || expanding;
  // Exhausted only when there is nothing to show AND nothing on the way. A field
  // still generating is not finished, it is early.
  const exhausted = scrolls.length === 0 && !generating;

  const page: FeedPage = {
    field: { id: field.id, name: field.name },
    scrolls,
    generating,
    topics_pending: pending,
    failed_topics: failed,
    exhausted,
    end_card: null,
    last_expansion: lastExpansion,
  };

  if (generating) page.retry_after_ms = config.retryAfterMs;

  if (exhausted) {
    const [viewed, adjacent] = await Promise.all([
      viewedCountInField(field.id, accountId),
      adjacentFields(field.id, config.adjacentFieldLimit),
    ]);
    // The feed ends and says so. It never silently loops back to the start —
    // that is the engagement pattern streaks were excluded to avoid (P8).
    page.end_card = { viewed_count: viewed, adjacent_fields: adjacent };
  }

  return page;
}

/**
 * Revision mode. Same shape, but deliberately never `exhausted`: the point is to
 * cycle back through what you have already seen, and it is entered on purpose.
 */
export async function buildRevisionPage(
  fieldName: string,
  accountId: string,
  limit: number,
): Promise<FeedPage> {
  const field: Field = await findOrCreateField(fieldName);
  const [scrolls, failed, lastExpansion] = await Promise.all([
    revisionPage(field.id, accountId, limit),
    failedTopics(field.id),
    latestExpansion(field.id),
  ]);

  return {
    field: { id: field.id, name: field.name },
    scrolls,
    generating: false,
    topics_pending: 0,
    failed_topics: failed,
    exhausted: false,
    end_card: null,
    last_expansion: lastExpansion,
  };
}

/**
 * Task 5.6, the "more topics" tap. User-triggered only - never called from paging
 * or polling, because both of its effects cost pipeline and LLM time (P16, P17).
 *
 * It returns at once. Candidate generation takes 32-54s in the background, so
 * how many NEW topics the tap produced is not known yet; it arrives in the feed's
 * `last_expansion` (DECISIONS 2026-09-16). Re-queuing failed topics is immediate,
 * so that count is returned here.
 *
 * Failed topics are re-queued even when an expansion is already running: that
 * part does not depend on the generator, and the user asked for it.
 */
export async function expandField(fieldId: string): Promise<ExpandResponse> {
  const failedRetried = await requeueFailedTopics(fieldId);
  const queued = await enqueueMoreExpansion(fieldId, failedRetried);
  return {
    expansion: queued ? "queued" : "already_running",
    failed_retried: failedRetried,
    retry_after_ms: config.retryAfterMs,
  };
}
