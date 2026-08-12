import { describe, it, expect } from "vitest";
import { extractJsonObject } from "./parse-json";

describe("extractJsonObject", () => {
  it("passes through pure json", () => {
    expect(extractJsonObject('{"a":1}')).toEqual({ a: 1 });
  });

  it("extracts json from a fenced code block", () => {
    const text = 'Here is the result:\n```json\n{"a":1}\n```\nDone.';
    expect(extractJsonObject(text)).toEqual({ a: 1 });
  });

  it("extracts json without a fence", () => {
    const text = 'Result: {"a":1} and more';
    expect(extractJsonObject(text)).toEqual({ a: 1 });
  });

  it("throws a clear error on non-json", () => {
    expect(() => extractJsonObject("this is not json")).toThrow(/JSON/i);
  });
});
