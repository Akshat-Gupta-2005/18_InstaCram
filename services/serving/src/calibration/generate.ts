/**
 * Calibration, phase A: generate real candidate topics for the calibration
 * fields and save them.
 *
 * The set is generated rather than invented so the threshold is tuned against
 * the text the system will actually embed — the generator's own names and its
 * own one-line descriptions. Output is committed so the later sweep is
 * reproducible and so the labels stay attached to the exact text they describe.
 */
import "../env.js";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { generateCandidates, type Candidate } from "../topics/candidates.js";
import { calibrationFields } from "./fields.js";

export interface CandidateSet {
  generated_at: string;
  fields: { field: string; kind: string; candidates: Candidate[] }[];
}

const outDir = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "calibration");
export const candidatesPath = join(outDir, "candidates.json");

async function main(): Promise<void> {
  const set: CandidateSet = { generated_at: new Date().toISOString(), fields: [] };

  for (const field of calibrationFields) {
    const started = Date.now();
    try {
      const candidates = await generateCandidates(field.name);
      const seconds = ((Date.now() - started) / 1000).toFixed(0);
      console.log(`${field.name}: ${candidates.length} candidates in ${seconds}s`);
      set.fields.push({ field: field.name, kind: field.kind, candidates });
    } catch (err) {
      console.error(`${field.name}: FAILED - ${err instanceof Error ? err.message : String(err)}`);
      set.fields.push({ field: field.name, kind: field.kind, candidates: [] });
    }
  }

  await mkdir(outDir, { recursive: true });
  await writeFile(candidatesPath, `${JSON.stringify(set, null, 2)}\n`, "utf8");

  const total = set.fields.reduce((n, f) => n + f.candidates.length, 0);
  console.log(`\nwrote ${total} candidates across ${set.fields.length} fields to calibration/candidates.json`);
}

main().catch((err: unknown) => {
  console.error("GENERATE FAILED:", err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
