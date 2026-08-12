import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "node:path";

const rootDir = import.meta.dirname ?? path.resolve(process.cwd());
const resolve = {
  alias: { "@": path.resolve(rootDir, "src") },
};

const coverage = {
  provider: "v8" as const,
  reporter: ["text", "json", "html"],
  thresholds: {
    lines: 80,
    statements: 80,
    functions: 80,
    branches: 80,
  },
  include: ["src/domain/**", "src/server/**"],
};

export default defineConfig({
  test: {
    projects: [
      {
        extends: true,
        resolve,
        test: {
          name: "unit",
          include: ["src/**/*.test.ts"],
          setupFiles: ["tests/setup.ts"],
          environment: "node",
        },
      },
      {
        extends: true,
        plugins: [react()],
        resolve,
        test: {
          name: "unit:dom",
          include: ["src/**/*.test.tsx"],
          setupFiles: ["tests/setup.ts"],
          environment: "jsdom",
        },
      },
      {
        extends: true,
        resolve,
        test: {
          name: "integration",
          include: ["tests/integration/**/*.test.ts", "tests/fixtures/**/*.test.ts"],
          setupFiles: ["tests/setup.ts"],
          environment: "node",
        },
      },
    ],
    coverage,
  },
});
