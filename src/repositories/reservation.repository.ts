import { Prisma, type Reservation } from "@prisma/client";
import type { Db } from "../types";


const RESERVATION_COLUMNS = Prisma.sql`id, item_id AS "itemId", user_id AS "userId", quantity, requested_quantity AS "requestedQuantity",
  idempotency_key AS "idempotencyKey", created_at AS "createdAt"`;

export async function insertReservation(
  db: Db,
  { itemId, userId, quantity, requestedQuantity, idempotencyKey }: {
    itemId: bigint;
    userId: string;
    quantity: number; // granted
    requestedQuantity: number;
    idempotencyKey?: string;
  },
): Promise<Reservation> {
  const rows = await db.$queryRaw<Reservation[]>`
    INSERT INTO reservations (item_id, user_id, quantity, requested_quantity, idempotency_key)
    VALUES (${itemId}, ${userId}, ${quantity}, ${requestedQuantity}, ${idempotencyKey ?? null})
    RETURNING ${RESERVATION_COLUMNS}`;
  return rows[0];
}

export async function findByIdempotencyKey(db: Db, key: string): Promise<Reservation | null> {
  const rows = await db.$queryRaw<Reservation[]>`
    SELECT ${RESERVATION_COLUMNS} FROM reservations WHERE idempotency_key = ${key}`;
  return rows[0] ?? null;
}

export async function deleteReservationsForItem(db: Db, itemId: bigint): Promise<void> {
  await db.$queryRaw`DELETE FROM reservations WHERE item_id = ${itemId}`;
}
