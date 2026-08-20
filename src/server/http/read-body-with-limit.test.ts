import { describe, it, expect } from "vitest";
import { readBodyWithLimit, RequestBodyTooLargeError } from "./read-body-with-limit";

describe("readBodyWithLimit", () => {
  it("returns empty string when body is null", async () => {
    expect(await readBodyWithLimit(null, 100)).toBe("");
  });

  it("decodes a small stream within limit", async () => {
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode("hello "));
        controller.enqueue(encoder.encode("world"));
        controller.close();
      },
    });

    const result = await readBodyWithLimit(stream, 100);
    expect(result).toBe("hello world");
  });

  it("decodes exactly at the byte limit", async () => {
    const encoder = new TextEncoder();
    const bytes = encoder.encode("1234567890"); // 10 bytes
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes);
        controller.close();
      },
    });

    const result = await readBodyWithLimit(stream, 10);
    expect(result).toBe("1234567890");
  });

  it("throws RequestBodyTooLargeError and cancels stream when limit is exceeded across chunks", async () => {
    let streamCancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array([1, 2, 3, 4, 5]));
        controller.enqueue(new Uint8Array([6, 7, 8, 9, 10]));
      },
      cancel() {
        streamCancelled = true;
      },
    });

    await expect(readBodyWithLimit(stream, 8)).rejects.toThrow(RequestBodyTooLargeError);
    expect(streamCancelled).toBe(true);
  });

  it("handles multibyte UTF-8 characters split across chunks without corruption", async () => {
    const encoder = new TextEncoder();
    // "中文" in UTF-8 is 6 bytes: [0xe4, 0xb8, 0xad, 0xe6, 0x96, 0x87]
    const fullBytes = encoder.encode("中文");
    expect(fullBytes.length).toBe(6);

    const chunk1 = fullBytes.subarray(0, 2); // splits the first 3-byte char
    const chunk2 = fullBytes.subarray(2, 5); // splits the second 3-byte char
    const chunk3 = fullBytes.subarray(5);

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(chunk1);
        controller.enqueue(chunk2);
        controller.enqueue(chunk3);
        controller.close();
      },
    });

    const result = await readBodyWithLimit(stream, 100);
    expect(result).toBe("中文");
  });
});
