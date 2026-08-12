import { describe, it, expect } from "vitest";
import { parseNdjsonStream } from "./ndjson";

function toReadableStream(chunks: string[]): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(new TextEncoder().encode(chunk));
      }
      controller.close();
    },
  });
}

describe("parseNdjsonStream (client)", () => {
  it("parses events across arbitrary chunk boundaries", async () => {
    const events: unknown[] = [];
    await parseNdjsonStream(toReadableStream(['{"a":1}\n{"a"', ':2}\n{"a":3}']), (e) => events.push(e));
    expect(events).toEqual([{ a: 1 }, { a: 2 }, { a: 3 }]);
  });

  it("throws a clear error on a malformed line", async () => {
    const events: unknown[] = [];
    await expect(
      parseNdjsonStream(toReadableStream(['{"a":1}\nnot-json\n']), (e) => events.push(e)),
    ).rejects.toThrow(/malformed/i);
  });

  it("handles an empty stream without events", async () => {
    const events: unknown[] = [];
    await parseNdjsonStream(toReadableStream([]), (e) => events.push(e));
    expect(events).toHaveLength(0);
  });
});
