import { describe, expect, it } from "vitest";
import { assessEvidenceSufficiency } from "./sufficiency";

describe("assessEvidenceSufficiency", () => {
  it.each([
    [{ supportCount: 2, corpusCount: 3000, conflictCount: 0, sourceStatus: "complete" as const }, "SUPPORT_BELOW_MINIMUM"],
    [{ supportCount: 3, corpusCount: 1000, conflictCount: 0, sourceStatus: "complete" as const }, "SUPPORT_RATIO_BELOW_MINIMUM"],
    [{ supportCount: 8, corpusCount: 100, conflictCount: 0, sourceStatus: "partial" as const }, "SOURCE_NOT_COMPLETE"],
    [{ supportCount: 8, corpusCount: 100, conflictCount: 8, sourceStatus: "complete" as const }, "CONFLICT_NOT_MINOR"],
  ])("marks %o insufficient", (input, reason) => {
    const result = assessEvidenceSufficiency(input);
    expect(result.status).toBe("insufficient");
    expect(result.reasons).toContain(reason);
  });

  it("marks a well-supported complete-source finding sufficient", () => {
    expect(assessEvidenceSufficiency({
      supportCount: 8,
      corpusCount: 100,
      conflictCount: 1,
      sourceStatus: "complete",
    })).toEqual({
      status: "sufficient",
      corpusReviewCount: 100,
      supportRatio: 0.08,
      reasons: [],
    });
  });
});
