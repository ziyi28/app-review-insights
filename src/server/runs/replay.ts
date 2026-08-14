import { promises as fs } from "node:fs";
import path from "node:path";
import type { RunManifest } from "./run-store";
import { ARTIFACT_NAMES, type ArtifactName, RunStore } from "./run-store";
import { RunEventSchema } from "@/domain/contracts/events";
import type { SourceFile } from "@/server/sources/source-types";

export type ReplayBundle = {
  manifest: RunManifest;
  events: unknown[];
  artifacts: Record<string, unknown>;
  /** Raw source files archived under sources/apple|import, read back for replay. */
  sourceFiles?: SourceFile[];
};

function isArtifactName(name: string): name is ArtifactName {
  return (ARTIFACT_NAMES as readonly string[]).includes(name);
}

async function discoveredArtifactNames(runDir: string): Promise<string[]> {
  try {
    const files = await fs.readdir(path.join(runDir, "artifacts"));
    const names = files
      .filter((f) => f.endsWith(".attempt-01.json"))
      .map((f) => f.replace(/\.attempt-01\.json$/, ""));
    return names.filter(isArtifactName);
  } catch {
    return [];
  }
}

/**
 * Loads a fully cached run for offline replay. Searches the given roots
 * (runtime store + bundled fixtures) for the run id. Reads only the run
 * snapshot and never constructs source or model clients.
 *
 * Only runs whose manifest is completed AND canReplay are replayable: a run
 * that ended as insufficient-data or failed must not be replayed as if it were
 * a complete analysis.
 *
 * Every event line is validated against RunEventSchema so a corrupt snapshot
 * is rejected outright rather than presented as a partial replay. Artifacts
 * are read through RunStore.readArtifact (which resolves run-relative names
 * inside the run directory), never by joining a manifest-provided path, so a
 * malicious manifest cannot read files outside its own run.
 */
export async function loadReplayRun(roots: string[], runId: string): Promise<ReplayBundle> {
  for (const root of roots) {
    const store = new RunStore(root);
    let manifest: RunManifest;
    try {
      manifest = await store.readManifest(runId);
    } catch {
      continue;
    }
    if (manifest.status !== "completed") {
      throw new Error(`Run ${runId} is not completed (${manifest.status})`);
    }
    if (manifest.canReplay !== true) {
      throw new Error(`Run ${runId} is not marked replayable (canReplay=false)`);
    }

    const runDir = store.resolveRunDir(runId);
    const eventsText = await fs.readFile(path.join(runDir, "events.ndjson"), "utf8");
    const events: unknown[] = [];
    for (const line of eventsText.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      let parsed: unknown;
      try {
        parsed = JSON.parse(trimmed);
      } catch {
        throw new Error(`Corrupt event in run ${runId}: not valid JSON`);
      }
      // Enforce the event protocol so a snapshot cannot smuggle in a
      // non-standard event that the client would not understand.
      const parsedEvent = RunEventSchema.safeParse(parsed);
      if (!parsedEvent.success) {
        throw new Error(`Corrupt event in run ${runId}: invalid event schema`);
      }
      events.push(parsedEvent.data);
    }

    const artifacts: Record<string, unknown> = {};

    // Prefer manifest-declared artifacts; otherwise scan the artifacts dir so
    // snapshots whose manifest was finalized with an empty artifacts map still
    // replay completely.
    const declared = Object.entries(manifest.artifacts);
    const names = declared.length > 0 ? declared.map(([name]) => name) : await discoveredArtifactNames(runDir);

    for (const name of names) {
      if (!isArtifactName(name)) throw new Error(`Unknown artifact in manifest: ${name}`);
      const info = manifest.artifacts[name];
      // Read through the store's safe resolver: attempt is validated and the
      // path stays inside the run directory (path traversal guard).
      const attempt = info?.attempt ?? 1;
      try {
        artifacts[name] = await store.readArtifact(runId, name, attempt);
      } catch {
        throw new Error(`Corrupt artifact ${name} for run ${runId}`);
      }
    }

    // Read back archived source files (raw Apple responses / imported files) so
    // a replay can re-materialize them in the new run directory. Only the safe
    // sources/apple|import trees are enumerated; a manifest can never name
    // arbitrary paths. Old runs and fixtures without sources/ simply have none.
    const sourceFiles: SourceFile[] = [];
    const sourcesRoot = path.join(runDir, "sources");
    for (const sub of ["apple", "import"] as const) {
      const dir = path.join(sourcesRoot, sub);
      let files: string[];
      try {
        files = await fs.readdir(dir);
      } catch {
        continue;
      }
      for (const f of files) {
        const content = await fs.readFile(path.join(dir, f), "utf8");
        sourceFiles.push({ relativePath: `sources/${sub}/${f}`, content });
      }
    }

    return { manifest, events, artifacts, sourceFiles };
  }
  throw new Error(`Run ${runId} not found in any replay root`);
}
