/**
 * Run `worker` over `items` with at most `concurrency` in flight. Results keep input order.
 * A worker that throws rejects the whole pool — callers that must not stop wrap their own errors.
 */
export async function mapPool(items, concurrency, worker) {
  const results = new Array(items.length);
  let next = 0;
  const lanes = Array.from({ length: Math.max(1, Math.min(concurrency, items.length)) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await worker(items[index], index);
    }
  });
  await Promise.all(lanes);
  return results;
}
