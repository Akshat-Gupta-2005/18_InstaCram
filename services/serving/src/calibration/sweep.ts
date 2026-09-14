/**
 * Calibration, phase C: measure a candidate embedding model against the labelled
 * pairs and find its best threshold.
 *
 * The rule, from BUILD-PLAN §4.2: take the LOWEST threshold at which false merges
 * are zero, then accept whatever split rate falls out. That encodes the asymmetry
 * deliberately — a false merge silently serves the wrong concept under a field,
 * while a split just regenerates something that already existed.
 *
 * Run once per candidate model, pointing it at that model's server:
 *   npx tsx src/calibration/sweep.ts --url http://localhost:8082 --label e5-base-v2
 *
 * Call tsx directly rather than going through `npm run ... -- --url`: PowerShell
 * swallows a bare `--`, so npm never forwards the arguments and the script
 * silently falls back to its defaults. That produced three identical runs of the
 * same model before it was spotted. SWEEP_URL and SWEEP_LABEL work too, and are
 * the safer option in any shell.
 */
import "dotenv/config";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { cosine, embed, embeddingInfo } from "../embeddings/client.js";
import { topicEmbeddingText } from "../topics/embeddingText.js";
import type { CandidateSet } from "./generate.js";

interface Ref {
  field: string;
  name: string;
}

interface LabelledPair {
  a: Ref;
  b: Ref;
  /** true = the same concept and SHOULD merge; false = different and MUST NOT. */
  same: boolean;
  why: string;
}

interface Labels {
  pairs: LabelledPair[];
}

interface ScoredPair extends LabelledPair {
  similarity: number;
}

const dataDir = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "calibration");

function arg(flag: string, fallback: string): string {
  const i = process.argv.indexOf(flag);
  const value = i === -1 ? undefined : process.argv[i + 1];
  return value ?? fallback;
}

function key(ref: Ref): string {
  return `${ref.field.toLowerCase()}::${ref.name.toLowerCase()}`;
}

async function main(): Promise<void> {
  const url = arg("--url", process.env.SWEEP_URL ?? process.env.EMBEDDINGS_URL ?? "http://localhost:8081");
  const label = arg("--label", process.env.SWEEP_LABEL ?? "current");
  const prefix = process.env.EMBEDDING_TEXT_PREFIX ?? "";

  const candidateSet = JSON.parse(
    await readFile(join(dataDir, "candidates.json"), "utf8"),
  ) as CandidateSet;
  const labels = JSON.parse(await readFile(join(dataDir, "labels.json"), "utf8")) as Labels;

  // Index every generated candidate by (field, name) so a label can point at the
  // exact text that was generated, not at a name retyped by hand.
  const byKey = new Map<string, string>();
  for (const f of candidateSet.fields) {
    for (const c of f.candidates) {
      byKey.set(key({ field: f.field, name: c.name }), topicEmbeddingText(c.name, c.description));
    }
  }

  const needed = new Set<string>();
  for (const pair of labels.pairs) {
    for (const ref of [pair.a, pair.b]) {
      if (!byKey.has(key(ref))) {
        throw new Error(`labels reference a candidate that was never generated: ${key(ref)}`);
      }
      needed.add(key(ref));
    }
  }

  const keys = [...needed];
  const texts = keys.map((k) => byKey.get(k)!);

  let modelId = label;
  try {
    modelId = (await embeddingInfo(url)).model_id;
  } catch {
    // /info is a convenience; the sweep works without it.
  }

  console.log(`model:  ${modelId}\nurl:    ${url}\nprefix: ${prefix === "" ? "(none)" : JSON.stringify(prefix)}`);
  const started = Date.now();
  const vectors = await embed(texts, url);
  const dims = vectors[0]?.length ?? 0;
  console.log(
    `embedded ${texts.length} topic strings in ${((Date.now() - started) / 1000).toFixed(1)}s (${dims} dimensions)\n`,
  );

  const vectorByKey = new Map<string, number[]>();
  keys.forEach((k, i) => vectorByKey.set(k, vectors[i]!));

  const scored: ScoredPair[] = labels.pairs.map((pair) => ({
    ...pair,
    similarity: cosine(vectorByKey.get(key(pair.a))!, vectorByKey.get(key(pair.b))!),
  }));

  const same = scored.filter((p) => p.same);
  const different = scored.filter((p) => !p.same);

  const worstDifferent = [...different].sort((a, b) => b.similarity - a.similarity);
  const hardestSame = [...same].sort((a, b) => a.similarity - b.similarity);

  const maxDifferent = worstDifferent[0]?.similarity ?? 0;
  const minSame = hardestSame[0]?.similarity ?? 1;

  // The whole question in one line: is there ANY gap between the two groups?
  const separable = minSame > maxDifferent;

  let chosen: number | null = null;
  let mergedAtChosen = 0;
  for (let t = 0.3; t <= 0.995; t += 0.005) {
    const falseMerges = different.filter((p) => p.similarity >= t).length;
    if (falseMerges === 0) {
      chosen = Number(t.toFixed(3));
      mergedAtChosen = same.filter((p) => p.similarity >= t).length;
      break;
    }
  }

  console.log(`pairs: ${same.length} same-concept, ${different.length} different-concept`);
  console.log(`highest similarity among DIFFERENT pairs: ${maxDifferent.toFixed(4)}`);
  console.log(`lowest  similarity among SAME pairs:      ${minSame.toFixed(4)}`);
  console.log(`separable: ${separable ? "YES" : "NO - the groups overlap"}\n`);

  console.log("closest different-concept pairs (these set the threshold):");
  for (const p of worstDifferent.slice(0, 5)) {
    console.log(`  ${p.similarity.toFixed(4)}  ${p.a.name} [${p.a.field}] vs ${p.b.name} [${p.b.field}] - ${p.why}`);
  }
  console.log("\nhardest same-concept pairs (these are the ones a strict threshold splits):");
  for (const p of hardestSame.slice(0, 5)) {
    console.log(`  ${p.similarity.toFixed(4)}  ${p.a.name} [${p.a.field}] vs ${p.b.name} [${p.b.field}] - ${p.why}`);
  }

  if (chosen === null) {
    console.log("\nRESULT: no threshold reaches zero false merges. This model cannot keep the");
    console.log("collision pairs apart, so the P4 deferral would not survive on it.");
  } else {
    const recall = same.length === 0 ? 0 : (mergedAtChosen / same.length) * 100;
    console.log(`\nRESULT: threshold ${chosen.toFixed(3)} - the lowest with ZERO false merges.`);
    console.log(
      `At it, ${mergedAtChosen}/${same.length} same-concept pairs still merge (${recall.toFixed(0)}% reuse); ` +
        `the rest become duplicate topics, which is the accepted cost.`,
    );
  }

  const outPath = join(dataDir, `sweep-${label}.json`);
  await writeFile(
    outPath,
    `${JSON.stringify(
      { model: modelId, url, prefix, dims, separable, maxDifferent, minSame, chosen, mergedAtChosen, pairs: scored },
      null,
      2,
    )}\n`,
    "utf8",
  );
  console.log(`\nwrote ${outPath}`);
}

main().catch((err: unknown) => {
  console.error("SWEEP FAILED:", err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
