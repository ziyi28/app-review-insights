import { describe, it, expect } from "vitest";
import { RunStartRequestSchema } from "./run";

describe("run start request contract", () => {
  it("accepts a valid live analyze request", () => {
    const req = RunStartRequestSchema.parse({
      protocolVersion: "1",
      mode: "analyze",
      uiLocale: "en",
      outputLocale: "en",
      goal: "Understand why users churn",
      source: { kind: "live", appStoreUrl: "https://apps.apple.com/us/app/x/id839285684" },
    });
    expect(req.mode).toBe("analyze");
  });

  it("accepts a valid import analyze request", () => {
    const req = RunStartRequestSchema.parse({
      protocolVersion: "1",
      mode: "analyze",
      uiLocale: "zh-CN",
      outputLocale: "zh-CN",
      goal: "理解用户为什么会流失以及如何改进订阅转化",
      source: {
        kind: "import",
        fileName: "reviews.csv",
        mediaType: "text/csv",
        content: "id,body,rating\n1,hi,5",
      },
    });
    if (req.mode === "analyze") {
      expect(req.source.kind).toBe("import");
    } else {
      throw new Error("expected analyze mode");
    }
  });

  it("accepts a cached-replay request", () => {
    const req = RunStartRequestSchema.parse({
      protocolVersion: "1",
      mode: "cached-replay",
      sourceRunId: "run-123",
    });
    expect(req.mode).toBe("cached-replay");
  });

  it("rejects an unknown protocol version", () => {
    expect(() =>
      RunStartRequestSchema.parse({ protocolVersion: "2", mode: "analyze" }),
    ).toThrow();
  });

  it("rejects a goal that is too short", () => {
    expect(() =>
      RunStartRequestSchema.parse({
        protocolVersion: "1",
        mode: "analyze",
        uiLocale: "en",
        outputLocale: "en",
        goal: "abc",
        source: { kind: "live", appStoreUrl: "https://apps.apple.com/us/app/x/id839285684" },
      }),
    ).toThrow();
  });

  it("rejects unknown analyze source kind", () => {
    expect(() =>
      RunStartRequestSchema.parse({
        protocolVersion: "1",
        mode: "analyze",
        uiLocale: "en",
        outputLocale: "en",
        goal: "Understand churn",
        source: { kind: "scrape", appStoreUrl: "https://apps.apple.com/us/app/x/id839285684" },
      }),
    ).toThrow();
  });

  it("rejects unknown media type", () => {
    expect(() =>
      RunStartRequestSchema.parse({
        protocolVersion: "1",
        mode: "analyze",
        uiLocale: "en",
        outputLocale: "en",
        goal: "Understand churn",
        source: { kind: "import", fileName: "x", mediaType: "application/pdf", content: "x" },
      }),
    ).toThrow();
  });

  it("rejects import content that is too large", () => {
    const big = "x".repeat(2_100_000);
    expect(() =>
      RunStartRequestSchema.parse({
        protocolVersion: "1",
        mode: "analyze",
        uiLocale: "en",
        outputLocale: "en",
        goal: "Understand churn",
        source: { kind: "import", fileName: "x.json", mediaType: "application/json", content: big },
      }),
    ).toThrow();
  });
});
