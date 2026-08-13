import { describe, it, expect } from "vitest";
import { dictionaries } from "./index";

describe("i18n dictionaries", () => {
  it("has identical keys across locales", () => {
    const enKeys = Object.keys(dictionaries.en).sort();
    const zhKeys = Object.keys(dictionaries["zh-CN"]).sort();
    expect(zhKeys).toEqual(enKeys);
  });

  it("provides all required navigation keys", () => {
    const required = ["appTitle", "newRun", "start", "overview", "rawReviews", "cleanedData", "topics", "findings", "versionPlan", "prd", "testCases", "traceability", "cachedReplay", "eventLog"];
    for (const key of required) {
      expect(dictionaries.en).toHaveProperty(key);
      expect(dictionaries["zh-CN"]).toHaveProperty(key);
    }
  });

  it("flags that reviews always use the US storefront", () => {
    expect(dictionaries.en.appStoreUrl).toMatch(/storefront/i);
    expect(dictionaries["zh-CN"].appStoreUrl).toContain("美国区");
  });

  it("provides key P1 workflow labels in Chinese", () => {
    const zh = dictionaries["zh-CN"];
    for (const key of ["classification", "evidenceValidation", "finalDeliverables", "draft", "final", "noRevisionRequired", "legacyArtifactUnavailable", "versionRationale", "modelAttempts", "modelRetries", "modelRetryReasons", "factorSeverity", "factorEvidenceStrength", "factorConfidence", "factorUserImpact", "factorFrequency", "factorImplementationScope", "factorDependency"] as const) {
      expect(zh[key].trim().length).toBeGreaterThan(0);
    }
  });
});
