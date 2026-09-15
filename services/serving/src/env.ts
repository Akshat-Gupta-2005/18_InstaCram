/**
 * Loads the repo-root .env, and must be imported FIRST by every entrypoint.
 *
 * Why this exists instead of a bare `import "dotenv/config"`: that form resolves
 * .env against the working directory, and every npm script here runs from
 * services/serving/. It would look for services/serving/.env and silently find
 * nothing, leaving the code on its defaults with no error to notice.
 *
 * There is deliberately ONE .env, at the repo root, because docker compose reads
 * that one and a second copy under each service would drift. A threshold that
 * disagrees between two files is exactly the kind of silent divergence the
 * calibrated value cannot survive.
 *
 * Real environment variables always win: dotenv does not overwrite what is
 * already set, so a container's compose-provided values are never clobbered by a
 * stray .env baked into an image.
 */
import { config as loadEnv } from "dotenv";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// src/env.ts -> src -> serving -> services -> repo root
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

export const envPath = resolve(repoRoot, ".env");

const result = loadEnv({ path: envPath });

/**
 * True when a .env was actually read. A missing file is NOT an error: in
 * containers every value arrives through compose, and in CI through the runner.
 * Callers that need a specific variable check for that variable, not for this.
 */
export const envFileLoaded = result.error === undefined;
