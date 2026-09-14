/**
 * Hand-written content so the feed can be built and tested with no LLM and no
 * pipeline in existence. Deliberately includes the awkward cases, because those
 * are the ones the feed gets wrong:
 *
 *   - a topic shared by two fields   -> the reuse claim, proved without any AI
 *   - a `pending` topic              -> the cold-start "generating" state
 *   - an `empty` topic               -> a run where every draft failed
 *   - a retired card                 -> must never appear anywhere
 */
import "dotenv/config";
import type { PoolClient } from "pg";
import { pool } from "./db/pool.js";

interface SeedIds {
  fields: Record<string, string>;
  topics: Record<string, string>;
  scrolls: Record<string, string[]>;
  retiredScrollId: string;
}

async function insertField(c: PoolClient, name: string): Promise<string> {
  const { rows } = await c.query<{ id: string }>(
    `INSERT INTO field (name) VALUES ($1) RETURNING id`,
    [name],
  );
  return rows[0]!.id;
}

async function insertTopic(
  c: PoolClient,
  name: string,
  description: string,
  status: "ready" | "pending" | "empty",
): Promise<string> {
  const { rows } = await c.query<{ id: string }>(
    `INSERT INTO topic (name, description, status) VALUES ($1, $2, $3) RETURNING id`,
    [name, description, status],
  );
  return rows[0]!.id;
}

async function link(c: PoolClient, fieldId: string, topicId: string): Promise<void> {
  await c.query(`INSERT INTO field_topic (field_id, topic_id) VALUES ($1, $2)`, [fieldId, topicId]);
}

async function insertScrolls(
  c: PoolClient,
  topicId: string,
  topicName: string,
  count: number,
  opts: { retireFirst?: boolean } = {},
): Promise<string[]> {
  const ids: string[] = [];
  for (let i = 1; i <= count; i++) {
    const { rows } = await c.query<{ id: string }>(
      `INSERT INTO scroll (topic_id, content, source_url, trust_label,
                           why_it_matters, recall_prompt, recall_answer, retired_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
      [
        topicId,
        `${topicName}: seeded card ${i}. Placeholder text standing in for a generated card.`,
        `https://example.org/${topicName.toLowerCase()}/${i}`,
        i % 2 === 0 ? "ai_generated" : "sourced_verified",
        `Knowing ${topicName} changes which option you reach for under time pressure.`,
        `What does ${topicName} do, in one sentence?`,
        `It is ${topicName}, card ${i}.`,
        opts.retireFirst && i === 1 ? new Date() : null,
      ],
    );
    ids.push(rows[0]!.id);
  }
  return ids;
}

export async function seed(c: PoolClient): Promise<SeedIds> {
  // TRUNCATE rather than DELETE: user_view is append-only and refuses deletes,
  // and TRUNCATE does not fire row-level triggers.
  await c.query(`TRUNCATE field, topic, field_topic, scroll, rejected_draft,
                 topic_generation_stats, outbox, account, user_view, saved_scroll,
                 erasure_log RESTART IDENTITY CASCADE`);

  const javaUtils = await insertField(c, "Java Utils");
  const javaCollections = await insertField(c, "Java Collections");
  const javaStreams = await insertField(c, "Java Streams");
  const behaviouralEconomics = await insertField(c, "Behavioural Economics");

  // Shared by two fields: one topic row, two links. This is the whole reuse claim.
  const hashMap = await insertTopic(
    c,
    "HashMap",
    "Hash-table map storing key-value pairs with average constant-time lookup.",
    "ready",
  );
  await link(c, javaUtils, hashMap);
  await link(c, javaCollections, hashMap);

  const optional = await insertTopic(
    c,
    "Optional",
    "Container object that may or may not hold a non-null value.",
    "ready",
  );
  await link(c, javaUtils, optional);

  const arrayList = await insertTopic(
    c,
    "ArrayList",
    "Resizable array giving fast indexed access and amortised appends.",
    "ready",
  );
  await link(c, javaCollections, arrayList);

  const treeSet = await insertTopic(
    c,
    "TreeSet",
    "Sorted set backed by a balanced tree with logarithmic operations.",
    "ready",
  );
  await link(c, javaCollections, treeSet);

  // Still generating: drives `generating: true` and a partial page.
  const collectors = await insertTopic(
    c,
    "Collectors",
    "Recipes that fold a stream's elements into a final result.",
    "pending",
  );
  await link(c, javaStreams, collectors);

  // Every draft failed fact-check: reported to the user, retried only by a
  // generation event, never by paging or polling.
  const lazyEval = await insertTopic(
    c,
    "Lazy Evaluation",
    "Deferring work until a terminal operation demands a result.",
    "empty",
  );
  await link(c, javaStreams, lazyEval);

  const anchoring = await insertTopic(
    c,
    "Anchoring",
    "Bias where an initial number pulls later estimates toward itself.",
    "ready",
  );
  await link(c, behaviouralEconomics, anchoring);

  // HashMap's first card is retired: it must never appear in any response.
  const hashMapScrolls = await insertScrolls(c, hashMap, "HashMap", 4, { retireFirst: true });
  const optionalScrolls = await insertScrolls(c, optional, "Optional", 2);
  const arrayListScrolls = await insertScrolls(c, arrayList, "ArrayList", 3);
  const treeSetScrolls = await insertScrolls(c, treeSet, "TreeSet", 2);
  const anchoringScrolls = await insertScrolls(c, anchoring, "Anchoring", 2);

  return {
    fields: {
      javaUtils,
      javaCollections,
      javaStreams,
      behaviouralEconomics,
    },
    topics: { hashMap, optional, arrayList, treeSet, collectors, lazyEval, anchoring },
    scrolls: {
      hashMap: hashMapScrolls.slice(1),
      optional: optionalScrolls,
      arrayList: arrayListScrolls,
      treeSet: treeSetScrolls,
      anchoring: anchoringScrolls,
    },
    retiredScrollId: hashMapScrolls[0]!,
  };
}

async function main(): Promise<void> {
  const client = await pool.connect();
  try {
    const ids = await seed(client);
    const live = Object.values(ids.scrolls).reduce((n, list) => n + list.length, 0);
    console.log(
      `seeded ${Object.keys(ids.fields).length} fields, ${Object.keys(ids.topics).length} topics, ` +
        `${live} live cards (+1 retired)`,
    );
  } finally {
    client.release();
    await pool.end();
  }
}

const invokedDirectly = process.argv[1]?.endsWith("seed.ts") || process.argv[1]?.endsWith("seed.js");
if (invokedDirectly) {
  main().catch((err: unknown) => {
    console.error("SEED FAILED:", err instanceof Error ? err.message : err);
    process.exitCode = 1;
  });
}
