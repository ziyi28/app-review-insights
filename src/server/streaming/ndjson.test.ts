import { describe, it, expect } from "vitest";
import { encodeNdjsonLine, NdjsonDecoder } from "./ndjson";

describe("ndjson", () => {
  it("encodes one json object per line", () => {
    expect(encodeNdjsonLine({ a: 1 })).toBe('{"a":1}\n');
  });

  it("decodes across arbitrary chunk boundaries", () => {
    const decoder = new NdjsonDecoder();
    const events: unknown[] = [];
    const chunks = ['{"a":1}\n{"a"', ':2}\n', '{"a":3}\n', "", '{"a":4}\n'];
    for (const chunk of chunks) {
      for (const line of decoder.push(chunk)) {
        events.push(JSON.parse(line));
      }
    }
    expect(events).toEqual([{ a: 1 }, { a: 2 }, { a: 3 }, { a: 4 }]);
  });

  it("reports a malformed line as an error", () => {
    const decoder = new NdjsonDecoder();
    expect(() => {
      const lines = decoder.push('{"a":1}\nnot-json\n');
      for (const l of lines) JSON.parse(l);
    }).toThrow();
  });

  it("does not emit until a newline arrives", () => {
    const decoder = new NdjsonDecoder();
    expect(decoder.push('{"a":1}')).toEqual([]);
  });
});
