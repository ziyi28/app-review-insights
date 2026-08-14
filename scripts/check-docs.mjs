import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import process from "node:process";

const root = process.cwd();

const README_FILES = {
  "README.md": {
    sections: [
      "快速开始",
      "数据来源与限制",
      "模型提供方与配置",
      "提示词与幻觉控制",
      "导入格式",
      "追溯规则",
      "缓存回放与数据真实性",
      "失败处理",
      "测试",
      "隐私与安全",
    ],
    capabilities: [
      "证据验证",
      "版本规划",
      "草稿 / 终稿",
      "3 次尝试",
      "中国区 App Store",
      "SerpApi",
      "SERPAPI_API_KEY",
      "apple_reviews",
      "no_cache=true",
      "Apple RSS 降级采集",
    ],
  },
  "README.en.md": {
    sections: [
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
    ],
    capabilities: [
      "Evidence Validation",
      "Version Planning",
      "Draft/Final",
      "3 attempts",
      "China App Store",
      "SerpApi",
      "SERPAPI_API_KEY",
      "apple_reviews",
      "no_cache=true",
      "Apple RSS fallback",
    ],
  },
};

const REQUIRED_DOCS = [
  "docs/import-format.md",
  "docs/model-analysis.md",
];

const REQUIRED_SCRIPTS = [
  "scripts/capture-real-run.ts",
  "scripts/build-real-demo.ts",
];

const REQUIRED_FIXTURES = [
  "fixtures/demo-runs/run-x-twitter-us/manifest.json",
  "fixtures/demo-runs/run-x-twitter-us/provenance.json",
  "fixtures/demo-runs/run-x-twitter-us/events.ndjson",
  "fixtures/demo-runs/run-x-twitter-us/artifacts/final-report.attempt-01.json",
];

// Sentences that contradict the bounded visible retry model; their reappearance
// means the docs drifted back to the old "never auto-retry" claim.
const FORBIDDEN_STATEMENTS = [
  "model calls are not auto-retried",
  "No automatic retries",
];

let failed = false;

const readmeContents = new Map();
for (const [file, { sections, capabilities }] of Object.entries(README_FILES)) {
  const readme = readFileSync(path.join(root, file), "utf8");
  readmeContents.set(file, readme);
  for (const heading of sections) {
    if (!readme.includes(`## ${heading}`)) {
      console.error(`${file} missing section: ## ${heading}`);
      failed = true;
    }
  }
  for (const token of capabilities) {
    if (!readme.includes(token)) {
      console.error(`${file} missing capability token: ${token}`);
      failed = true;
    }
  }
}
const readme = readmeContents.get("README.en.md");
const modelAnalysis = readFileSync(path.join(root, "docs/model-analysis.md"), "utf8");
// model-analysis.md documents the analysis pipeline; it does not need the
// SerpApi acquisition tokens, only the original P1 capability set.
const P1_CAPABILITIES = ["Evidence Validation", "Version Planning", "Draft/Final", "3 attempts", "China App Store"];
for (const token of P1_CAPABILITIES) {
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
// environment or the git-ignored `.env.local`, verify it does not leak into
// tracked files. The value itself is never printed.
function localEnvValue(name) {
  if (!existsSync(".env.local")) return undefined;
  const line = readFileSync(".env.local", "utf8")
    .split(/\r?\n/)
    .find((entry) => entry.trim().startsWith(`${name}=`));
  if (!line) return undefined;
  const raw = line.slice(line.indexOf("=") + 1).trim();
  return raw.startsWith('"') && raw.endsWith('"')
    ? raw.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, "\\")
    : raw;
}

const configuredSecrets = [
  process.env.MODEL_API_KEY?.trim() || localEnvValue("MODEL_API_KEY"),
  process.env.SERPAPI_API_KEY?.trim() || localEnvValue("SERPAPI_API_KEY"),
].filter((value) => value && value.length >= 12);

for (const secret of configuredSecrets) {
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
