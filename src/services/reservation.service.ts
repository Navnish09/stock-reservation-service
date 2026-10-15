import { UNIQUE_VIOLATION } from "../config/constants";
import { prisma } from "../db/prisma";
import { withTransaction } from "../db/transaction";
import { Errors, pgErrorCode } from "../lib/errors";
import * as itemRepo from "../repositories/item.repository";
import * as reservationRepo from "../repositories/reservation.repository";
import type { ReserveInput, ReserveResult } from "../types";
import { strategies } from "./strategies";

// Reserve up to `quantity` units of `sku` for `userId`. Reservations are permanent.
// If fewer than `quantity` are left, the user gets what's left.
// only a sold-out item (0 left) is rejected.
//
// Unit of work (ONE transaction):
//   1. decrement the stock counter
//   2. insert a row in the reservation ledger
// Both succeed or both roll back, the counter and ledger can never be out of sync.
export async function reserve(input: ReserveInput): Promise<ReserveResult> {
  const { sku, userId, quantity, idempotencyKey, strategyName } = input;
  const strategy = strategies[strategyName];

  // Same key seen before, return the original result.
  if (idempotencyKey) {
    const existing = await reservationRepo.findByIdempotencyKey(prisma, idempotencyKey);
    if (existing) return { reservation: existing, replayed: true };
  }

  const item = await itemRepo.findItemBySku(prisma, sku);
  if (!item) throw Errors.notFound(`Item ${sku}`);

  try {
    return await withTransaction(async (tx) => {
      const grant = await strategy.decrementStock(tx, item.id, quantity);

      // throwing error inside the transaction so it triggers ROLLBACK
      if (!grant) throw Errors.outOfStock();

      const reservation = await reservationRepo.insertReservation(tx, {
        itemId: item.id,
        userId,
        // the quantity could be less than what was requested to achieve partial fulfilment.
        quantity: grant.granted,
        requestedQuantity: quantity,
        idempotencyKey,
      });
      return { reservation, remaining: grant.remaining, replayed: false };
    });
  } catch (err) {
    // To handle the case when the transaction rolled back but the reservation was actually inserted (e.g. a unique constraint violation on the idempotency key), 
    // we check if the error is a UNIQUE_VIOLATION and if so, 
    // we look up the existing reservation by idempotency key and return it as a replayed result.
    if (idempotencyKey && pgErrorCode(err) === UNIQUE_VIOLATION) {
      const existing = await reservationRepo.findByIdempotencyKey(prisma, idempotencyKey);
      if (existing) return { reservation: existing, replayed: true };
    }
    throw err;
  }
}
