import type { RunManifest } from "./run-store";
import { RunStore } from "./run-store";

export type CatalogEntry = {
  runId: string;
  manifest: RunManifest;
  root: string;
};

/**
 * Lists replayable runs from the runtime store plus bundled fixtures
 * (e.g. `fixtures/demo-runs/*`). Runs whose manifest is corrupt are skipped
 * (never served as partial replays).
 */
export class RunCatalog {
  constructor(private readonly roots: string[]) {}

  async list(): Promise<CatalogEntry[]> {
    const entries: CatalogEntry[] = [];
    for (const root of this.roots) {
      const store = new RunStore(root);
      const runIds = await store.listRuns();
      for (const runId of runIds) {
        try {
          const manifest = await store.readManifest(runId);
          entries.push({ runId, manifest, root });
        } catch {
          // skip corrupt runs
        }
      }
    }
    return entries.sort((a, b) => (a.manifest.createdAt < b.manifest.createdAt ? 1 : -1));
  }
}
