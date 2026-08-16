import { describe, it, expect } from "vitest";
import { dedupeLimitations } from "./limitations";

describe("dedupeLimitations", () => {
  it("keeps the first entry per code+message pair and preserves order", () => {
    const input = [
      { code: "RSS_PARTIAL", message: "a", stage: "source" },
      { code: "RSS_PARTIAL", message: "a", stage: "prepare" },
      { code: "RSS_PARTIAL", message: "b", stage: "source" },
      { code: "RSS_PARTIAL", message: "a", stage: "source" },
    ];
    expect(dedupeLimitations(input)).toEqual([
      { code: "RSS_PARTIAL", message: "a", stage: "source" },
      { code: "RSS_PARTIAL", message: "b", stage: "source" },
    ]);
  });

  it("returns an empty array unchanged", () => {
    expect(dedupeLimitations([])).toEqual([]);
  });
});
