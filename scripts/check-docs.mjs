import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import process from "node:process";

const root = process.cwd();

const REQUIRED_README = [
  "Quick Start",
  "Data Sources and Limitations",
  "Model Provider and Configuration",
  "Prompt and Hallucination Controls",
  "Import Format",
  "Traceability Rules",
  "Cached Replay and Data Authenticity",
  "Failure Handling",
  "Testing",
  "Privacy and Security",
];

const REQUIRED_DOCS = [
  "docs/import-format.md",
  "docs/model-analysis.md",
];

const REQUIRED_SCRIPTS = [
  "scripts/capture-real-run.ts",
  "scripts/build-real-demo.ts",
];

const REQUIRED_FIXTURES = [
  "fixtures/demo-runs/run-workout-for-women-us/manifest.json",
  "fixtures/demo-runs/run-workout-for-women-us/provenance.json",
  "fixtures/demo-runs/run-workout-for-women-us/events.ndjson",
  "fixtures/demo-runs/run-workout-for-women-us/artifacts/final-report.attempt-01.json",
];

let failed = false;

const readme = readFileSync(path.join(root, "README.md"), "utf8");
for (const heading of REQUIRED_README) {
  if (!readme.includes(`## ${heading}`)) {
    console.error(`README missing section: ## ${heading}`);
    failed = true;
  }
}

for (const f of [...REQUIRED_DOCS, ...REQUIRED_SCRIPTS, ...REQUIRED_FIXTURES]) {
  if (!existsSync(path.join(root, f))) {
    console.error(`missing file: ${f}`);
    failed = true;
  }
}

// No secrets must be present anywhere tracked. If a key is supplied via the
// environment, verify it does not leak into tracked files.
const secret = process.env.MODEL_API_KEY?.trim();
if (secret) {
  const { execSync } = await import("node:child_process");
  const tracked = execSync("git ls-files", { cwd: root, encoding: "utf8" });
  const files = tracked.split("\n").filter(Boolean);
  for (const f of files) {
    if (!existsSync(path.join(root, f))) continue;
    const content = readFileSync(path.join(root, f), "utf8");
    if (content.includes(secret)) {
      console.error(`SECRET FOUND in tracked file: ${f}`);
      failed = true;
    }
  }
}

if (failed) {
  console.error("\nDocs check failed.");
  process.exit(1);
}
console.log("Docs check passed.");
