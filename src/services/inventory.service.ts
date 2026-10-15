import { prisma } from "../db/prisma";
import { withTransaction } from "../db/transaction";
import { AppError, Errors } from "../lib/errors";
import * as itemRepo from "../repositories/item.repository";
import * as reservationRepo from "../repositories/reservation.repository";
import * as gateRepo from "../repositories/stockGate.repository";
import { DRAIN_TIMEOUT_MS } from "../config/constants";

// Creates the item or resets it to `quantity` and clears its reservations.
export async function initializeStock({ sku, quantity }: { sku: string; quantity: number }) {
  // Reservations accepted by the Redis gate may still be queued for Postgres. Let them land first,
  // otherwise they would be written on top of the freshly reset item. To handle the case when the Redis is down.
  const gateUp = await gateRepo.waitForDrain(DRAIN_TIMEOUT_MS).then(
    (drained) => {
      if (!drained) throw Errors.writesPending();
      return true;
    },
    (err) => {
      if (err instanceof AppError) throw err;
      console.warn("[gate] Redis unreachable, skipping gate reset");
      return false;
    },
  );

  const item = await withTransaction(async (tx) => {
    const item = await itemRepo.upsertItem(tx, { sku, quantity });
    await reservationRepo.deleteReservationsForItem(tx, item.id);
    return item;
  });
  if (gateUp) await gateRepo.resetStock(sku, quantity).catch((err) => console.warn("[gate] reset failed", err.message));
  return { sku: item.sku, totalQuantity: item.totalQuantity, available: item.available };
}

export async function getStock(sku: string) {
  const item = await itemRepo.findItemBySku(prisma, sku);
  if (!item) throw Errors.notFound(`Item ${sku}`);
  const stats = await itemRepo.getItemStats(prisma, item.id);
  return {
    sku: item.sku,
    totalQuantity: item.totalQuantity,
    available: item.available,
    reservedQuantity: stats.reservedQuantity,
    reservationCount: stats.reservationCount,
    distinctUsers: stats.distinctUsers,
    // Counter and ledger must match. else a race condition happened.
    consistent: item.available + stats.reservedQuantity === item.totalQuantity,
    // Redis state values, remaining units in Redis and accepted reservations not yet in Postgres. It's null if Redis is down.
    gate: await Promise.all([gateRepo.getStock(sku), gateRepo.pendingWrites()]).then(
      ([available, pendingWrites]) => ({ available, pendingWrites }),
      () => null,
    ),
  };
}
