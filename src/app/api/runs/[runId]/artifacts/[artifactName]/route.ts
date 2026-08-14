import path from "node:path";
import { NextResponse } from "next/server";
import { RunStore, ARTIFACT_NAMES } from "@/server/runs/run-store";
import { loadConfig } from "@/server/config";

export const runtime = "nodejs";

/** 只有文件系统报告的 `ENOENT` 才表示 manifest 不存在；JSON 解析、权限等
 *  错误说明 manifest 存在但损坏/不可读，必须视为 500 而不是“不存在”。 */
function isMissingManifestError(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as NodeJS.ErrnoException).code === "ENOENT";
}

/**
 * Returns a specific artifact attempt for a run, selected by ?attempt=<n>.
 * Without ?attempt the manifest's declared latest attempt is served.
 *
 * During a run the manifest is only finalized at the end, so intermediate
 * artifact reads must not depend on a manifest index: we try the manifest's
 * declared attempt and fall back to attempt 1 for artifacts written before the
 * manifest was finalized.
 *
 * Ownership is resolved in two phases. First the runtime store, then the
 * bundled fixture root, is checked for a manifest: the first root whose
 * manifest exists owns the run id, and every artifact/attempt read happens
 * against that owner only — an artifact missing there is a 404 and never falls
 * back to a same-named fixture artifact. A manifest that exists but is corrupt
 * or unreadable is a 500, never mistaken for "absent". Only when no manifest
 * exists in any root is the runtime root allowed to serve an early attempt-01
 * artifact written before the manifest was finalized.
 */
export async function GET(req: Request, { params }: { params: Promise<{ runId: string; artifactName: string }> }) {
  const { runId, artifactName } = await params;
  if (!(ARTIFACT_NAMES as readonly string[]).includes(artifactName)) {
    return notFound("unknown artifact");
  }
  const rawAttempt = new URL(req.url).searchParams.get("attempt");
  const requestedAttempt = rawAttempt === null ? null : Number(rawAttempt);
  if (requestedAttempt !== null && (!Number.isInteger(requestedAttempt) || requestedAttempt < 1)) {
    return NextResponse.json({ error: "invalid attempt" }, { status: 422, headers: { "cache-control": "no-store" } });
  }
  const cfg = loadConfig();
  const roots = [cfg.runsDir, path.join(process.cwd(), "fixtures", "demo-runs")];

  // 阶段一：确定 manifest 所有者。第一个存在 manifest 的 root 拥有 run id。
  let owner: RunStore | null = null;
  let ownerAttempt = 1;
  for (const root of roots) {
    const store = new RunStore(root);
    try {
      const manifest = await store.readManifest(runId);
      owner = store;
      const info = manifest.artifacts[artifactName];
      if (info?.attempt) ownerAttempt = info.attempt;
      break;
    } catch (error) {
      if (!isMissingManifestError(error)) {
        return NextResponse.json(
          { error: "manifest unreadable" },
          { status: 500, headers: { "cache-control": "no-store" } },
        );
      }
      // ENOENT：该 root 没有 manifest，继续检查下一个 root。
    }
  }

  // 阶段二：从所有者 root 读取 artifact，绝不回落到其他 root。
  if (owner !== null) {
    if (requestedAttempt !== null && requestedAttempt > ownerAttempt) {
      return notFound("artifact attempt not found");
    }
    try {
      const value = await owner.readArtifact(runId, artifactName, requestedAttempt ?? ownerAttempt);
      return NextResponse.json(value, {
        headers: { "cache-control": "no-store" },
      });
    } catch {
      return notFound("artifact not found");
    }
  }

  // 所有 root 都没有 manifest：只允许读取早期没有 manifest 的 attempt-01
  // artifact。更高 attempt 无 manifest 索引，无法判定其归属，必须 404。
  if (requestedAttempt !== null && requestedAttempt !== 1) {
    return notFound("artifact attempt not found");
  }
  try {
    const value = await new RunStore(cfg.runsDir).readArtifact(runId, artifactName, requestedAttempt ?? 1);
    return NextResponse.json(value, {
      headers: { "cache-control": "no-store" },
    });
  } catch {
    return notFound("artifact not found");
  }
}

/** 文件内私有辅助函数：统一生成带 `cache-control: no-store` 的 404 JSON。 */
function notFound(message: string): NextResponse {
  return NextResponse.json({ error: message }, { status: 404, headers: { "cache-control": "no-store" } });
}
