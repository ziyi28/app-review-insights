import path from "node:path";
import { promises as fs } from "node:fs";
import { NextResponse } from "next/server";
import { RunStore } from "@/server/runs/run-store";
import { RunEventSchema } from "@/domain/contracts/events";
import { loadConfig } from "@/server/config";

export const runtime = "nodejs";

/**
 * Returns a completed run's event stream as a JSON array, for read-only
 * history viewing (no model, no replay). Searches both the runtime store and
 * the bundled fixtures so a demo run can also be inspected.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ runId: string }> }) {
  const { runId } = await params;
  const cfg = loadConfig();
  const roots = [cfg.runsDir, path.join(process.cwd(), "fixtures", "demo-runs")];

  for (const root of roots) {
    const store = new RunStore(root);
    let text: string;
    try {
      text = await fs.readFile(path.join(store.resolveRunDir(runId), "events.ndjson"), "utf8");
    } catch {
      continue;
    }
    const events = text
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .map((line) => {
        const parsed = RunEventSchema.safeParse(JSON.parse(line));
        return parsed.success ? parsed.data : null;
      })
      .filter((e) => e !== null);
    return NextResponse.json({ events }, { headers: { "cache-control": "no-store" } });
  }

  return NextResponse.json({ error: "run events not found" }, { status: 404, headers: { "cache-control": "no-store" } });
}
