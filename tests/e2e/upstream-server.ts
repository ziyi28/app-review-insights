import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import os from "node:os";

export type UpstreamState = {
  socialCrawlRequests: number;
  rssRequests: number;
  modelRequests: number;
};

/**
 * Request counters live in a temp file shared between the Playwright
 * globalSetup process (which runs the upstream server) and the test workers
 * (which assert on the counts). globalThis is NOT shared across processes, so
 * counters must be persisted to disk for the zero-upstream-call assertion to
 * be real rather than always comparing -1 === -1.
 */
const COUNTERS_FILE = path.join(os.tmpdir(), "laientech-e2e-upstream-counters.json");

/** Switch: "live" serves the SocialCrawl success envelope; "fallback" serves a 402. */
const STUB_SWITCH_FILE = path.join(os.tmpdir(), "laientech-e2e-socialcrawl-mode.json");

export function setSocialCrawlMode(mode: "live" | "fallback"): void {
  writeFileSync(STUB_SWITCH_FILE, JSON.stringify({ mode }), "utf8");
}

function socialCrawlMode(): "live" | "fallback" {
  try {
    if (existsSync(STUB_SWITCH_FILE)) {
      const parsed = JSON.parse(readFileSync(STUB_SWITCH_FILE, "utf8")) as { mode?: "live" | "fallback" };
      if (parsed.mode === "fallback") return "fallback";
    }
  } catch {
    // ignore corrupt switch
  }
  return "live";
}

export function readCounters(): UpstreamState {
  try {
    if (existsSync(COUNTERS_FILE)) {
      const parsed = JSON.parse(readFileSync(COUNTERS_FILE, "utf8")) as Partial<UpstreamState>;
      return {
        socialCrawlRequests: parsed.socialCrawlRequests ?? 0,
        rssRequests: parsed.rssRequests ?? 0,
        modelRequests: parsed.modelRequests ?? 0,
      };
    }
  } catch {
    // ignore corrupt counters
  }
  return { socialCrawlRequests: 0, rssRequests: 0, modelRequests: 0 };
}

export function resetCounters(): void {
  writeFileSync(COUNTERS_FILE, JSON.stringify({ socialCrawlRequests: 0, rssRequests: 0, modelRequests: 0 }), "utf8");
}

function bump(kind: "socialcrawl" | "rss" | "model"): void {
  const current = readCounters();
  const next = {
    socialCrawlRequests: current.socialCrawlRequests + (kind === "socialcrawl" ? 1 : 0),
    rssRequests: current.rssRequests + (kind === "rss" ? 1 : 0),
    modelRequests: current.modelRequests + (kind === "model" ? 1 : 0),
  };
  writeFileSync(COUNTERS_FILE, JSON.stringify(next), "utf8");
}

/** Snapshot for assertions (exact current counts). */
export function getUpstreamState(): UpstreamState {
  return readCounters();
}

/**
 * Local upstream stub for E2E. Serves Apple RSS-style pages and an
 * OpenAI-compatible /chat/completions endpoint so the app under test runs
 * without real network. Request counters let tests assert zero upstream calls
 * during cached replay.
 */
export function startUpstreamServer() {
  resetCounters();

  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const url = req.url ?? "";
    if (url.startsWith("/v1/app_store/app-reviews")) {
      bump("socialcrawl");
      const headers = req.headers;
      const params = new URLSearchParams(url.split("?")[1] ?? "");
      const mode = socialCrawlMode();
      const validRequest =
        headers["x-api-key"] === "sc_e2e_only" &&
        headers["cache-control"] === "no-cache" &&
        typeof headers["idempotency-key"] === "string" &&
        params.get("country") === "US" &&
        params.get("language") === "en" &&
        params.get("depth") === "500" &&
        params.get("sort_by") === "most_recent";
      if (!validRequest) {
        res.writeHead(401, { "content-type": "application/json" });
        res.end(JSON.stringify({ success: false, error: { type: "INVALID_API_KEY", message: "bad request" } }));
        return;
      }
      if (mode === "fallback") {
        res.writeHead(402, { "content-type": "application/json" });
        res.end(JSON.stringify({ success: false, error: { type: "INSUFFICIENT_CREDITS", message: "out of credits" } }));
        return;
      }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          success: true,
          platform: "app_store",
          endpoint: "/v1/app_store/app-reviews",
          data: {
            items: [
              { review: { id: "r1", entity_id: "839285684", title: "Great workout", text: "I love the workout variety and it is easy to follow at home.", rating: { value: 5, max: 5 }, author: { name: "user-1" }, published_at: "2026-07-01T10:00:00Z", ext: { appdata: { version: "3.2.1" } } } },
              { review: { id: "r2", entity_id: "839285684", title: "Too expensive", text: "The subscription is way too expensive for me.", rating: { value: 1, max: 5 }, author: { name: "user-2" }, published_at: "2026-07-02T10:00:00Z", ext: { appdata: { version: "3.2.0" } } } },
            ],
            total: 2,
            dropped: 0,
          },
          credits_used: 5,
          credits_remaining: 95,
          request_id: "req_e2e",
          cached: false,
          pagination: { next_cursor: null, has_more: false, page_size: 50 },
        }),
      );
      return;
    }

    if (url.startsWith("/rss/customerreviews")) {
      bump("rss");
      const page = url.match(/page=(\d+)/)?.[1] ?? "1";
      if (Number(page) === 1) {
        const body = JSON.stringify({
          feed: {
            entry: [
              {
                id: { label: "r1" },
                updated: { label: "2026-07-01T10:00:00Z" },
                "im:rating": { label: "5" },
                "im:version": { label: "3.2.1" },
                title: { label: "Great workout" },
                content: { label: "I love the workout variety and it is easy to follow at home.", attributes: { type: "text" } },
              },
              {
                id: { label: "r2" },
                updated: { label: "2026-07-02T10:00:00Z" },
                "im:rating": { label: "1" },
                "im:version": { label: "3.2.0" },
                title: { label: "Too expensive" },
                content: { label: "The subscription is way too expensive for me.", attributes: { type: "text" } },
              },
            ],
            link: [],
          },
        });
        res.writeHead(200, { "content-type": "application/json" });
        res.end(body);
      } else {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ feed: { entry: [], link: [] } }));
      }
      return;
    }

    if (url === "/v1/chat/completions") {
      bump("model");
      let raw = "";
      req.on("data", (chunk) => (raw += chunk));
      req.on("end", () => {
        const content = scriptedModelResponse(JSON.parse(raw));
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ choices: [{ message: { content }, finish_reason: "stop" }], usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 } }));
      });
      return;
    }

    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "not found" }));
  });

  return {
    listen: (port: number) => new Promise<number>((resolve) => server.listen(port, () => resolve(port))),
    close: () => new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve()))),
    port: () => {
      const addr = server.address();
      return typeof addr === "object" && addr ? addr.port : 0;
    },
  };
}

export const UPSTREAM_PORT = 39876;

/**
 * Deterministic model script for the E2E live path, dispatched on unquoted
 * markers (instruction strings get JSON-escaped inside the payload).
 * Order matters: findings carries candidateIds from the topics input, so it is
 * matched before consolidation.
 */
function scriptedModelResponse(body: { messages?: { role: string; content: string }[] }): string {
  const last = body.messages?.at(-1)?.content ?? "";

  if (last.includes("expectedResult")) {
    // tests (may also carry acceptanceCriteria from the requirements input)
    return JSON.stringify({
      tests: [
        { id: "test-1", requirementIds: ["req-1"], sourceReviewIds: ["r1"], testType: "manual", precondition: "", steps: ["open app", "browse workouts"], expectedResult: "new workouts listed" },
        { id: "test-2", requirementIds: ["req-2"], sourceReviewIds: ["r2"], testType: "manual", precondition: "", steps: ["open pricing", "select annual"], expectedResult: "annual plan selectable" },
      ],
    });
  }
  if (last.includes("acceptanceCriteria")) {
    return JSON.stringify({
      title: "Release plan", overview: "Improve experience",
      versions: [{ id: "ver-1", name: "1.0.0", summary: "Content + pricing", rationale: "Ships the highest-impact improvements first", requirementIds: ["req-1", "req-2"] }],
      requirements: [
        { id: "req-1", findingIds: ["finding-1"], title: "Add workout variety", description: "more workouts", priority: "P1", acceptanceCriteria: ["new workouts listed"], versionId: "ver-1", planningFactors: { severity: "high", userImpact: "high", implementationScope: "medium", dependencyRequirementIds: [], rationale: "Supported user impact and bounded implementation scope" } },
        { id: "req-2", findingIds: ["finding-2"], title: "Offer annual plan", description: "cheaper option", priority: "P1", acceptanceCriteria: ["annual plan selectable"], versionId: "ver-1", planningFactors: { severity: "high", userImpact: "high", implementationScope: "small", dependencyRequirementIds: [], rationale: "High user impact with small implementation scope" } },
      ],
      assumptions: [],
    });
  }
  if (last.includes("evidenceExcerpts")) {
    return JSON.stringify({
      findings: [
        { id: "finding-1", topicIds: ["topic-1"], title: "Loves variety", summary: "Users praise workout variety", supportingReviewIds: ["r1"], evidenceExcerpts: [{ reviewId: "r1", excerpt: "workout variety" }], conflictingReviewIds: [], uncertainties: [], limitations: [] },
        { id: "finding-2", topicIds: ["topic-1"], title: "Too expensive", summary: "Users find it costly", supportingReviewIds: ["r2"], evidenceExcerpts: [{ reviewId: "r2", excerpt: "too expensive" }], conflictingReviewIds: [], uncertainties: [], limitations: [] },
      ],
    });
  }
  if (last.includes("candidateIds")) {
    // Discovery namespaces candidate ids per chunk (@c0), so consolidation
    // must reference the namespaced ids to match validated candidates.
    return JSON.stringify({ topics: [{ id: "topic-1", label: "Workout quality", description: "d", candidateIds: ["topic-candidate-1@c0", "topic-candidate-2@c0"] }] });
  }
  if (last.includes("supportingReviewIds")) {
    return JSON.stringify({
      topics: [
        { id: "topic-candidate-1", label: "Workout quality", description: "d", supportingReviewIds: ["r1"], quote: "workout variety" },
        { id: "topic-candidate-2", label: "Pricing", description: "d", supportingReviewIds: ["r2"], quote: "too expensive" },
      ],
    });
  }
  return JSON.stringify({ interpretation: "Understand mixed sentiment", filters: { rating: [], versions: [], languages: [], minDate: null, maxDate: null }, explicitLimitations: [] });
}
