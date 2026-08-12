export function encodeNdjsonLine(value: unknown): string {
  return JSON.stringify(value) + "\n";
}

/**
 * Incremental NDJSON decoder that splits on newlines regardless of chunk
 * boundaries. Consumers call push() with arbitrary chunks and receive complete
 * lines; trailing partial lines are buffered until a newline arrives.
 */
export class NdjsonDecoder {
  private buffer = "";

  push(chunk: string): string[] {
    this.buffer += chunk;
    const lines: string[] = [];
    let idx: number;
    while ((idx = this.buffer.indexOf("\n")) >= 0) {
      lines.push(this.buffer.slice(0, idx));
      this.buffer = this.buffer.slice(idx + 1);
    }
    return lines;
  }
}
