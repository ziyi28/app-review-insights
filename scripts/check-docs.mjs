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

// P1 capability facts the docs must keep stating. A doc drift that drops one
// of these is a failed check even if every other section stays intact.
const REQUIRED_CAPABILITIES = [
  "Evidence Validation",
  "Version Planning",
  "Draft/Final",
  "3 attempts",
  "China App Store",
];

// Sentences that contradict the bounded visible retry model; their reappearance
// means the docs drifted back to the old "never auto-retry" claim.
const FORBIDDEN_STATEMENTS = [
  "model calls are not auto-retried",
  "No automatic retries",
];

let failed = false;

const readme = readFileSync(path.join(root, "README.md"), "utf8");
for (const heading of REQUIRED_README) {
  if (!readme.includes(`## ${heading}`)) {
    console.error(`README missing section: ## ${heading}`);
    failed = true;
  }
}

for (const token of REQUIRED_CAPABILITIES) {
  if (!readme.includes(token)) {
    console.error(`README missing P1 capability token: ${token}`);
    failed = true;
  }
}
const modelAnalysis = readFileSync(path.join(root, "docs/model-analysis.md"), "utf8");
for (const token of REQUIRED_CAPABILITIES) {
  if (!modelAnalysis.includes(token)) {
    console.error(`docs/model-analysis.md missing P1 capability token: ${token}`);
    failed = true;
  }
}
for (const sentence of FORBIDDEN_STATEMENTS) {
  if (readme.includes(sentence)) {
    console.error(`README contains forbidden no-retry statement: ${sentence}`);
    failed = true;
  }
  if (modelAnalysis.includes(sentence)) {
    console.error(`docs/model-analysis.md contains forbidden no-retry statement: ${sentence}`);
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
