import { Prisma, type Item } from "@prisma/client";
import type { Db, ItemStats } from "../types";

const ITEM_COLUMNS = Prisma.sql`id, sku, total_quantity AS "totalQuantity", available,
  created_at AS "createdAt", updated_at AS "updatedAt"`;

export async function upsertItem(db: Db, { sku, quantity }: { sku: string; quantity: number }): Promise<Item> {
  const rows = await db.$queryRaw<Item[]>`
    INSERT INTO items (sku, total_quantity, available)
    VALUES (${sku}, ${quantity}, ${quantity})
    ON CONFLICT (sku) DO UPDATE
      SET total_quantity = EXCLUDED.total_quantity,
          available      = EXCLUDED.available,
          updated_at     = NOW()
    RETURNING ${ITEM_COLUMNS}`;
  return rows[0];
}

export async function findItemBySku(db: Db, sku: string): Promise<Item | null> {
  const rows = await db.$queryRaw<Item[]>`SELECT ${ITEM_COLUMNS} FROM items WHERE sku = ${sku}`;
  return rows[0] ?? null;
}

export async function getItemStats(db: Db, itemId: bigint): Promise<ItemStats> {
  const rows = await db.$queryRaw<ItemStats[]>`
    SELECT COUNT(*)::int                   AS "reservationCount",
           COALESCE(SUM(quantity), 0)::int AS "reservedQuantity",
           COUNT(DISTINCT user_id)::int    AS "distinctUsers"
      FROM reservations
     WHERE item_id = ${itemId}`;
  return rows[0];
}
