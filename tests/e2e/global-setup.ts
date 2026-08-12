import { startUpstreamServer, UPSTREAM_PORT } from "./upstream-server";

/** Starts the shared upstream stub once for all E2E files. */
export default async function globalSetup(): Promise<() => Promise<void>> {
  const upstream = startUpstreamServer();
  await upstream.listen(UPSTREAM_PORT);
  return () => upstream.close();
}
