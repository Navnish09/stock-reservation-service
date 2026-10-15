import type { Grant, Tx } from "../../types";

// Pessimistic locking — SELECT query with FOR UPDATE.
//
// It Locks the row first, then read, then write.
// Any other transaction trying to lock the same row WAITS until it is commited.
//
// Drawback: 2 round trips while holding the lock -> lock is held longer than the
// atomic version, so throughput on a high demand row is lower.
export async function decrementStock(tx: Tx, itemId: bigint, requested: number): Promise<Grant | null> {
  const rows = await tx.$queryRaw<{ available: number }[]>`
    SELECT available FROM items WHERE id = ${itemId} FOR UPDATE`;
  if (!rows.length || rows[0].available <= 0) return null;

  const granted = Math.min(rows[0].available, requested); // partial fulfilment
  const updated = await tx.$queryRaw<{ available: number }[]>`
    UPDATE items
       SET available = available - ${granted}, updated_at = NOW()
     WHERE id = ${itemId}
 RETURNING available`;
  return { granted, remaining: updated[0].available };
}
