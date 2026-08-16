export function encodeNdjsonLine(value: unknown): string {
  return JSON.stringify(value) + "\n";
}
