/**
 * Shared batching helpers for pipeline stages that split a review corpus into
 * size-bounded chunks and run per-chunk model calls with bounded concurrency.
 * Both topics and findings need the same shape, so it lives here rather than
 * being duplicated per stage.
 */

/**
 * Splits items into chunks whose cumulative `bodyNormalized` length stays under
 * `budget`. A single item always joins its chunk even if it alone exceeds the
 * budget (chunks are never empty), so no item is dropped.
 */
export function chunkByBodyBudget<T extends { bodyNormalized: string }>(items: T[], budget: number): T[][] {
  const chunks: T[][] = [];
  let current: T[] = [];
  let chars = 0;
  for (const item of items) {
    const cost = item.bodyNormalized.length + 16;
    if (current.length > 0 && chars + cost > budget) {
      chunks.push(current);
      current = [];
      chars = 0;
    }
    current.push(item);
    chars += cost;
  }
  if (current.length > 0) chunks.push(current);
  return chunks;
}

/** Maps `items` through `fn` with at most `limit` calls in flight at once. */
export async function mapWithConcurrency<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return results;
}
