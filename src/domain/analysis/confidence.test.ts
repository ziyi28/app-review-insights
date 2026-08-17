import { describe, it, expect } from "vitest";
import { computeConfidence } from "./confidence";

// Defaults keep the v1 scenarios unchanged; quality signals are set high
// enough that they never downgrade on their own.
function conf(overrides: Partial<Parameters<typeof computeConfidence>[0]> = {}) {
  return computeConfidence({
    supportCount: 9,
    supportRatio: 0.5,
    sourceStatus: "complete",
    conflictCount: 0,
    meanBodyLength: 80,
    ratingVariance: 1,
    ...overrides,
  });
}

describe("computeConfidence", () => {
  it("labels 1-2 supporting reviews as low", () => {
    expect(conf({ supportCount: 1 }).level).toBe("low");
    expect(conf({ supportCount: 2 }).level).toBe("low");
  });

  it("labels 3-7 as medium", () => {
    expect(conf({ supportCount: 3 }).level).toBe("medium");
  });

  it("labels 8+ as high", () => {
    expect(conf({ supportCount: 9 }).level).toBe("high");
  });

  it("downgrades when the source is partial", () => {
    expect(conf({ supportCount: 9, sourceStatus: "partial" }).level).toBe("medium");
  });

  it("caps at medium when there is material conflict", () => {
    expect(conf({ supportCount: 9, conflictCount: 3 }).level).toBe("medium");
  });

  it("keeps high when conflict is minor/weak (<25% of support)", () => {
    // 39 support, 2 conflict -> ratio ~0.05 < 0.25 -> high
    expect(conf({ supportCount: 39, conflictCount: 2 }).level).toBe("high");
  });

  it("caps at medium when conflict is material (>=25% of support)", () => {
    // 84 support, 42 conflict -> ratio 0.50 >= 0.25 -> medium
    expect(conf({ supportCount: 84, conflictCount: 42 }).level).toBe("medium");
  });

  it("never goes below low", () => {
    expect(conf({ supportCount: 1, sourceStatus: "partial", conflictCount: 5 }).level).toBe("low");
  });

  it("downgrades high to medium when support covers a negligible share of the corpus", () => {
    const result = conf({ supportCount: 9, supportRatio: 0.005 });
    expect(result.level).toBe("medium");
    expect(result.reasons).toContain("support covers a negligible share of the corpus");
  });

  it("keeps high when support ratio clears the floor", () => {
    expect(conf({ supportCount: 9, supportRatio: 0.02 }).level).toBe("high");
  });

  it("downgrades high to medium when supporting reviews are uniformly short", () => {
    const result = conf({ supportCount: 9, meanBodyLength: 5 });
    expect(result.level).toBe("medium");
    expect(result.reasons).toContain("supporting reviews are uniformly short");
  });

  it("downgrades high to medium when ratings are homogeneous", () => {
    const result = conf({ supportCount: 9, ratingVariance: 0 });
    expect(result.level).toBe("medium");
    expect(result.reasons).toContain("supporting reviews share a homogeneous rating");
  });

  it("emits the deterministic-v2 method and auditable reasons", () => {
    const result = conf({ supportCount: 9, supportRatio: 0.5 });
    expect(result.method).toBe("deterministic-v2");
    expect(result.reasons).toContain("9 distinct supporting content group(s)");
    expect(result.reasons).toContain("source status: complete");
  });
});
