import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { promises as fs } from "node:fs";
import path from "node:path";
import type { RunStartRequest } from "@/domain/contracts/run";

export const ARTIFACT_NAMES = [
  "scope",
  "source-evidence",
  "raw-reviews",
  "cleaned-reviews",
  "stats",
  "analysis-sample",
  "topic-candidates",
  "topics",
  "findings",
  "evidence-validation",
  "goal-coverage",
  "version-plan",
  "prd",
  "tests",
  "traceability",
  "final-report",
] as const;
export type ArtifactName = (typeof ARTIFACT_NAMES)[number];

/** Persisted manifest status. A run that was `running` when the process died is
 *  computed as `interrupted` at read time; it is never written to disk. */
export type RunManifestStatus = "running" | "completed" | "failed" | "cancelled";

/** Effective status exposed to the UI: a persisted `running` manifest whose task
 *  is no longer active in the in-process registry reads as `interrupted`. */
export type RunStatus = RunManifestStatus | "interrupted";

export type RunManifest = {
  runId: string;
  status: RunManifestStatus;
  executionMode: "live" | "import" | "cached-replay";
  createdAt: string;
  updatedAt: string;
  /** The analysis goal the user entered; persisted so the history list can
   *  show what each run was about. Optional because pre-existing manifests
   *  predate this field. */
  goal?: string;
  /** Friendly app display name extracted from App Store URL or provider. */
  appName?: string;
  /** Canonical App Store URL for live / cached-replay runs. */
  appUrl?: string;
  /** Imported file name for import mode. */
  fileName?: string;
  /** Request payload used to start the run, enabling one-click retry. */
  startRequest?: RunStartRequest;
  stages: Record<string, { status: string; startedAt?: string; finishedAt?: string; attempt?: number }>;
  artifacts: Record<string, { attempt: number; file: string }>;
  limitations: { code: string; message: string }[];
  canReplay: boolean;
  modelUsage?: Record<string, unknown>;
  promptVersions?: string[];
};

function runIdRegex(runId: string): void {
  if (!/^run-[a-z0-9-]{1,120}$/.test(runId)) {
    throw new Error(`Invalid run id: ${runId}`);
  }
}

function artifactNameOk(name: string): name is ArtifactName {
  return (ARTIFACT_NAMES as readonly string[]).includes(name);
}

/**
 * File-based run snapshot store. All writes are atomic (temp file + rename),
 * attempt files are immutable, and every resolved path stays inside the run
 * directory (path traversal / SSRF guard).
 */
export class RunStore {
  constructor(private readonly root: string) {}

  createRunId(): string {
    return `run-${randomUUID()}`;
  }

  resolveRunDir(runId: string): string {
    runIdRegex(runId);
    const resolved = path.resolve(this.root, runId);
    if (!resolved.startsWith(path.resolve(this.root))) {
      throw new Error(`Run id escapes the store root: ${runId}`);
    }
    return resolved;
  }

  existsFile(file: string): boolean {
    return existsSync(file);
  }

  async writeArtifact(runId: string, name: string, attempt: number, value: unknown): Promise<string> {
    if (!artifactNameOk(name)) throw new Error(`Unknown artifact name: ${name}`);
    if (!Number.isInteger(attempt) || attempt < 1) throw new Error(`Invalid attempt: ${attempt}`);
    const runDir = this.resolveRunDir(runId);
    await fs.mkdir(runDir, { recursive: true });
    const artifactsDir = path.join(runDir, "artifacts");
    await fs.mkdir(artifactsDir, { recursive: true });
    const fileName = `${name}.attempt-${String(attempt).padStart(2, "0")}.json`;
    const finalPath = path.join(artifactsDir, fileName);
    const tmp = path.join(artifactsDir, `.${fileName}.${randomUUID()}.tmp`);
    await fs.writeFile(tmp, JSON.stringify(value, null, 2), "utf8");
    await fs.rename(tmp, finalPath);
    return finalPath;
  }

  async readArtifact(runId: string, name: string, attempt: number): Promise<unknown> {
    if (!artifactNameOk(name)) throw new Error(`Unknown artifact name: ${name}`);
    const runDir = this.resolveRunDir(runId);
    const fileName = `${name}.attempt-${String(attempt).padStart(2, "0")}.json`;
    const file = path.join(runDir, "artifacts", fileName);
    return JSON.parse(await fs.readFile(file, "utf8"));
  }

  /**
   * Atomically writes a raw source file (response body / imported file) into
   * the run directory. Only run-relative paths under `sources/apple/` or
   * `sources/import/` are accepted; the resolved target must stay inside the
   * run directory (path traversal / SSRF guard). The same path may never be
   * overwritten, so archived source bytes are immutable.
   */
  async writeSourceFile(runId: string, relativePath: string, content: string): Promise<void> {
    const runDir = this.resolveRunDir(runId);
    const sourcesRoot = path.resolve(runDir, "sources");
    // Both the raw prefix and the RESOLVED path must stay inside the sources
    // tree: `sources/apple/../../x.json` starts with a valid prefix but
    // resolves outside it, and a bare absolute path never starts under sources.
    if (!/^sources\/(apple|import)\//.test(relativePath)) {
      throw new Error(`Source file path not allowed: ${relativePath}`);
    }
    const resolved = path.resolve(sourcesRoot, relativePath.replace(/^sources\//, ""));
    const allowedRoot = path.resolve(runDir, "sources");
    if (!resolved.startsWith(allowedRoot + path.sep)) {
      throw new Error(`Source file path escapes the sources tree: ${relativePath}`);
    }
    await fs.mkdir(path.dirname(resolved), { recursive: true });
    if (existsSync(resolved)) {
      throw new Error(`Source file already exists: ${relativePath}`);
    }
    const tmp = path.join(path.dirname(resolved), `.${path.basename(resolved)}.${randomUUID()}.tmp`);
    await fs.writeFile(tmp, content, "utf8");
    await fs.rename(tmp, resolved);
  }

  async readSourceFile(runId: string, relativePath: string): Promise<string> {
    const runDir = this.resolveRunDir(runId);
    const resolved = path.resolve(runDir, relativePath);
    if (!resolved.startsWith(path.resolve(runDir) + path.sep)) {
      throw new Error(`Source file path escapes the run directory: ${relativePath}`);
    }
    return fs.readFile(resolved, "utf8");
  }

  /**
   * Appends a fully-framed NDJSON line (must already end with "\n"). Writing an
   * already-framed line keeps the on-disk byte stream identical to the HTTP
   * stream and avoids double newlines between events.
   */
  async appendEvent(runId: string, line: string): Promise<void> {
    const runDir = this.resolveRunDir(runId);
    await fs.mkdir(runDir, { recursive: true });
    if (!line.endsWith("\n")) line += "\n";
    await fs.appendFile(path.join(runDir, "events.ndjson"), line, "utf8");
  }

  async writeManifest(runId: string, manifest: RunManifest): Promise<void> {
    const runDir = this.resolveRunDir(runId);
    await fs.mkdir(runDir, { recursive: true });
    manifest.updatedAt = new Date().toISOString();
    const tmp = path.join(runDir, `.manifest.${randomUUID()}.tmp`);
    await fs.writeFile(tmp, JSON.stringify(manifest, null, 2), "utf8");
    await fs.rename(tmp, path.join(runDir, "manifest.json"));
  }

  async readManifest(runId: string): Promise<RunManifest> {
    const runDir = this.resolveRunDir(runId);
    return JSON.parse(await fs.readFile(path.join(runDir, "manifest.json"), "utf8")) as RunManifest;
  }

  async listRuns(): Promise<string[]> {
    try {
      const entries = await fs.readdir(this.root);
      return entries.filter((e) => e.startsWith("run-"));
    } catch {
      return [];
    }
  }

  /**
   * Recursively removes a run directory (manifest, events, artifacts). The run
   * id is validated by resolveRunDir before removal, so a malicious id cannot
   * delete anything outside the store root. `force: true` makes deleting an
   * already-absent directory a no-op.
   */
  async deleteRun(runId: string): Promise<void> {
    await fs.rm(this.resolveRunDir(runId), { recursive: true, force: true });
  }
}
