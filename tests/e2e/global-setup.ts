import { startUpstreamServer, UPSTREAM_PORT } from "./upstream-server";
import { rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Test-only persistence directories, isolated from real `data/` state so E2E
// runs never read or write a live app's runs/cache/previews.
const TEST_ONLY_DIRS = ["runs-e2e", "source-cache-e2e", "source-previews-e2e"];

/**
 * Safely removes the three test-only directories. Each path is resolved against
 * `<workspace>/data/` and asserted to sit inside it before deletion, so an
 * environment variable, glob, workspace root, or user directory can never be
 * the recursive-delete target.
 */
function cleanTestDirs(): void {
  const workspace = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));
  const dataDir = path.resolve(workspace, "data");
  for (const name of TEST_ONLY_DIRS) {
    const target = path.resolve(dataDir, name);
    if (!target.startsWith(dataDir + path.sep)) {
      throw new Error(`Refusing to delete outside data/: ${target}`);
    }
    rmSync(target, { recursive: true, force: true });
  }
}

/** Starts the shared upstream stub once for all E2E files. */
export default async function globalSetup(): Promise<() => Promise<void>> {
  cleanTestDirs();
  const upstream = startUpstreamServer();
  await upstream.listen(UPSTREAM_PORT);
  return () => {
    cleanTestDirs();
    return upstream.close();
  };
}
