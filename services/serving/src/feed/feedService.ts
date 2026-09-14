import { config } from "../config.js";
import { adjacentFields, findOrCreateField, type Field } from "../repo/fields.js";
import {
  failedTopics,
  pendingTopicCount,
  revisionPage,
  unviewedPage,
  viewedCountInField,
} from "../repo/feed.js";
import type { FeedPage } from "../types.js";

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
  const [scrolls, pending, failed] = await Promise.all([
    unviewedPage(field.id, accountId, limit),
    pendingTopicCount(field.id),
    failedTopics(field.id),
  ]);

  const generating = pending > 0;
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
  const [scrolls, failed] = await Promise.all([
    revisionPage(field.id, accountId, limit),
    failedTopics(field.id),
  ]);

  return {
    field: { id: field.id, name: field.name },
    scrolls,
    generating: false,
    topics_pending: 0,
    failed_topics: failed,
    exhausted: false,
    end_card: null,
  };
}
