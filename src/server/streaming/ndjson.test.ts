import { describe, it, expect } from "vitest";
import { encodeNdjsonLine } from "./ndjson";

describe("ndjson", () => {
  it("encodes one json object per line", () => {
    expect(encodeNdjsonLine({ a: 1 })).toBe('{"a":1}\n');
  });
});
