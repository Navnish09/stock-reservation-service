import type { Grant, Tx } from "../../types";

// RECOMMENDED — Atomic conditional update, with partial fulfilment.
//
// Postgres takes a row lock for the UPDATE; concurrent UPDATEs on the same
// row wait, then RE-EVALUATE the WHERE clause against the newly committed row. 
// So `available > 0` and LEAST(available, requested) are always
// computed from the true current value.
//
// Asked for 5, only 3 left -> LEAST(3, 5) = 3 granted, stock becomes 0.
export async function decrementStock(tx: Tx, itemId: bigint, requested: number): Promise<Grant | null> {
  const rows = await tx.$queryRaw<Grant[]>`
    UPDATE items
       SET available = available - LEAST(available, ${requested}),
           updated_at = NOW()
     WHERE id = ${itemId} AND available > 0
 RETURNING (old.available - new.available) AS granted, new.available AS remaining`;

return rows[0] ?? null;
}
