import { describe, it, expect } from "vitest";
import { computeConfidence } from "./confidence";

describe("computeConfidence", () => {
  it("labels 1-2 supporting reviews as low", () => {
    expect(computeConfidence({ supportCount: 1, sourceStatus: "complete", hasConflict: false }).level).toBe("low");
    expect(computeConfidence({ supportCount: 2, sourceStatus: "complete", hasConflict: false }).level).toBe("low");
  });

  it("labels 3-7 as medium", () => {
    expect(computeConfidence({ supportCount: 3, sourceStatus: "complete", hasConflict: false }).level).toBe("medium");
  });

  it("labels 8+ as high", () => {
    expect(computeConfidence({ supportCount: 9, sourceStatus: "complete", hasConflict: false }).level).toBe("high");
  });

  it("downgrades when the source is partial", () => {
    expect(computeConfidence({ supportCount: 9, sourceStatus: "partial", hasConflict: false }).level).toBe("medium");
  });

  it("caps at medium when there is material conflict", () => {
    expect(computeConfidence({ supportCount: 9, sourceStatus: "complete", hasConflict: true }).level).toBe("medium");
  });

  it("never goes below low", () => {
    expect(computeConfidence({ supportCount: 1, sourceStatus: "partial", hasConflict: true }).level).toBe("low");
  });
});
