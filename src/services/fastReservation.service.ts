import { prisma } from "../db/prisma";
import { AppError, Errors } from "../lib/errors";
import * as itemRepo from "../repositories/item.repository";
import * as gateRepo from "../repositories/stockGate.repository";
import type { FastReserveInput, FastReserveResult } from "../types";

// High-throughput reservation. The stock decision is made in Redis, using one Lua script.
// the reservation is queued and written to Postgres in batches by the writer.
// Once this returns, the reservation is final.
export async function reserveFast(input: FastReserveInput): Promise<FastReserveResult> {
  try {
    let result = await gateRepo.tryReserve(input);

    // First use of this Stock, or Redis was cleared. Seed the stock counter from Postgres, then retry.
    if (result.outcome === "NO_STOCK_KEY") {
      const item = await itemRepo.findItemBySku(prisma, input.sku);
      if (!item) throw Errors.notFound(`Item ${input.sku}`);
      await gateRepo.seedStock(input.sku, item.available);
      result = await gateRepo.tryReserve(input);
    }

    if (result.outcome === "SOLD_OUT") throw Errors.outOfStock();
    if (!("grant" in result)) throw Errors.gateUnavailable();
    return { grant: result.grant, replayed: result.outcome === "REPLAY" };
  } catch (err) {
    if (err instanceof AppError) throw err;
    console.error("[gate]", err);
    throw Errors.gateUnavailable();
  }
}
