import path from "node:path";
import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { loadConfig } from "@/server/config";
import { parseAppStoreUrl } from "@/server/sources/app-store-url";
import { buildPreviewSnapshot, pruneExpiredPreviews, type SourcePreview, type LiveProvider } from "@/server/sources/source-preview";

export const runtime = "nodejs";

export const SourcePreviewRequestSchema = z.object({
  protocolVersion: z.literal("1"),
  appStoreUrl: z.string().url().refine((u) => u.startsWith("https://"), { message: "must be https" }),
});
export type SourcePreviewRequest = z.infer<typeof SourcePreviewRequestSchema>;

/**
 * Builds a source preview: collects live Apple RSS reviews and reads the local
 * review cache for the stable sample, persisting a snapshot (valid for 30
 * minutes) that a later /api/runs request can reference. The HTTP response
 * carries only summaries — full reviews never leave the server.
 */
export async function POST(req: Request) {
  const cfg = loadConfig();

  // Lazy cleanup of expired previews on the write path.
  await pruneExpiredPreviews(cfg.sourcePreviewsDir, new Date().toISOString());

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return problem("400", "invalid JSON body");
  }

  const parsed = SourcePreviewRequestSchema.safeParse(body);
  if (!parsed.success) {
    return problem("422", "invalid request", parsed.error.issues[0]?.message);
  }

  let appId: string;
  let canonicalUrl: string;
  try {
    const u = parseAppStoreUrl(parsed.data.appStoreUrl);
    appId = u.appId;
    canonicalUrl = u.canonicalUrl;
  } catch (err) {
    return problem("422", "invalid app store url", err instanceof Error ? err.message : String(err));
  }

  const previewId = `preview-${randomUUID()}`;
  const now = new Date().toISOString();

  const preview = await buildPreviewSnapshot({
    previewId,
    appId,
    canonicalUrl,
    now,
    // SerpApi deps are built only when a key is configured; otherwise the
    // preview dispatches straight to the RSS fallback.
    serpApiCollector: cfg.serpApiKey
      ? {
          fetchFn: fetch,
          now: () => new Date().toISOString(),
          baseUrl: cfg.serpApiBaseUrl,
          apiKey: cfg.serpApiKey,
          appId,
          timeoutMs: cfg.serpApiTimeoutMs,
          signal: req.signal,
        }
      : null,
    rssCollector: {
      fetchFn: fetch,
      sleep: (ms: number) => new Promise<void>((r) => setTimeout(r, ms)),
      now: () => new Date().toISOString(),
      baseUrl: cfg.appleRssBaseUrl,
      appId,
      maxPages: cfg.appleRssMaxPages,
      pageDelayMs: cfg.appleRssPageDelayMs,
      timeoutMs: cfg.appleRssTimeoutMs,
      signal: req.signal,
    },
    previewsDir: cfg.sourcePreviewsDir,
    cacheDir: cfg.sourceCacheDir,
    historyRoots: [cfg.runsDir, path.join(process.cwd(), "fixtures", "demo-runs")],
    runsDir: cfg.runsDir,
  });

  return NextResponse.json(toPublicPreview(preview), {
    headers: { "cache-control": "no-store" },
  });
}

/** Strips the full review payloads and secrets so the browser never receives them. */
function toPublicPreview(preview: SourcePreview) {
  return {
    protocolVersion: "1",
    previewId: preview.previewId,
    appId: preview.appId,
    canonicalUrl: preview.canonicalUrl,
    createdAt: preview.createdAt,
    expiresAt: preview.expiresAt,
    live: {
      provider: preview.live.provider as LiveProvider,
      forcedRefresh: preview.live.forcedRefresh,
      cached: preview.live.cached,
      collectedAt: preview.live.collectedAt,
      status: preview.live.status,
      reviewCount: preview.live.reviewCount,
      pageCount: preview.live.pageCount,
      requestCount: preview.live.requestCount,
      dateRange: preview.live.dateRange,
      limitations: preview.live.limitations,
      searchCount: "searchIds" in preview.live.evidence ? preview.live.evidence.requestCount : 0,
      searchId: "searchIds" in preview.live.evidence ? (preview.live.evidence.searchIds.at(-1) ?? null) : null,
    },
    stable: {
      available: preview.stable.available,
      reviewCount: preview.stable.reviewCount,
      cacheUpdatedAt: preview.stable.cacheUpdatedAt,
      dateRange: preview.stable.dateRange,
      bootstrapRunId: preview.stable.bootstrapRunId,
    },
    recommendedSelection: preview.recommendedSelection,
  };
}

function problem(status: string, title: string, detail?: string): NextResponse {
  return NextResponse.json({ type: "about:blank", title, status, detail }, { status: Number(status), headers: { "content-type": "application/problem+json" } });
}
