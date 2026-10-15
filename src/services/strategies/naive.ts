import type { Grant, Tx } from "../../types";

// BROKEN ON PURPOSE — read-modify-write approach without a lock.
//
// Two requests both read available=5, both compute 5-1=4, both write 4.
// Two reservations were recorded but stock only dropped by 1 => LOST UPDATE
// => more stock units reserved than exist.
// Kept only so the load test can demonstrate the faulty race condition.
export async function decrementStock(tx: Tx, itemId: bigint, requested: number): Promise<Grant | null> {
  const rows = await tx.$queryRaw<{ available: number }[]>`SELECT available FROM items WHERE id = ${itemId}`;
  if (!rows.length || rows[0].available <= 0) return null;

  const granted = Math.min(rows[0].available, requested);
  const remaining = rows[0].available - granted; // computed in app memory: stale!
  await tx.$queryRaw`UPDATE items SET available = ${remaining}, updated_at = NOW() WHERE id = ${itemId}`;
  return { granted, remaining };
}
