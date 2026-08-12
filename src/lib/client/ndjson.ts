/**
 * Client-side NDJSON stream parser. Buffers partial lines across chunks and
 * yields one JSON object per line. A malformed line rejects the whole stream.
 */
export async function parseNdjsonStream(
  stream: ReadableStream<Uint8Array>,
  onEvent: (event: unknown) => void,
): Promise<void> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx: number;
    while ((idx = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, idx).trim();
      buffer = buffer.slice(idx + 1);
      if (!line) continue;
      try {
        onEvent(JSON.parse(line));
      } catch {
        throw new Error(`Malformed NDJSON line: ${line.slice(0, 200)}`);
      }
    }
  }
  // Flush any trailing line that lacks a final newline.
  const tail = buffer.trim();
  if (tail) {
    try {
      onEvent(JSON.parse(tail));
    } catch {
      throw new Error(`Malformed NDJSON line: ${tail.slice(0, 200)}`);
    }
  }
}
