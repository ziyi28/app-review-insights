import { describe, it, expect } from "vitest";
import { computeConfidence } from "./confidence";

describe("computeConfidence", () => {
  it("labels 1-2 supporting reviews as low", () => {
    expect(computeConfidence({ supportCount: 1, sourceStatus: "complete", conflictCount: 0 }).level).toBe("low");
    expect(computeConfidence({ supportCount: 2, sourceStatus: "complete", conflictCount: 0 }).level).toBe("low");
  });

  it("labels 3-7 as medium", () => {
    expect(computeConfidence({ supportCount: 3, sourceStatus: "complete", conflictCount: 0 }).level).toBe("medium");
  });

  it("labels 8+ as high", () => {
    expect(computeConfidence({ supportCount: 9, sourceStatus: "complete", conflictCount: 0 }).level).toBe("high");
  });

  it("downgrades when the source is partial", () => {
    expect(computeConfidence({ supportCount: 9, sourceStatus: "partial", conflictCount: 0 }).level).toBe("medium");
  });

  it("caps at medium when there is material conflict", () => {
    expect(computeConfidence({ supportCount: 9, sourceStatus: "complete", conflictCount: 3 }).level).toBe("medium");
  });

  it("keeps high when conflict is minor/weak (<25% of support)", () => {
    // 39 support, 2 conflict -> ratio ~0.05 < 0.25 -> high
    expect(computeConfidence({ supportCount: 39, sourceStatus: "complete", conflictCount: 2 }).level).toBe("high");
  });

  it("caps at medium when conflict is material (>=25% of support)", () => {
    // 84 support, 42 conflict -> ratio 0.50 >= 0.25 -> medium
    expect(computeConfidence({ supportCount: 84, sourceStatus: "complete", conflictCount: 42 }).level).toBe("medium");
  });

  it("never goes below low", () => {
    expect(computeConfidence({ supportCount: 1, sourceStatus: "partial", conflictCount: 5 }).level).toBe("low");
  });
});

