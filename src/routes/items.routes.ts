import { Router } from "express";
import { config } from "../config";
import { STRATEGY_NAMES } from "../config/constants";
import type { StrategyName } from "../types";
import { validate } from "../middleware/validate";
import * as inventoryService from "../services/inventory.service";
import * as reservationService from "../services/reservation.service";
import { reserveFast } from "../services/fastReservation.service";
import { asyncHandler } from "../lib/utils";
import { InitBody, ReserveBody, SkuParams } from "../config/schemas";

export const itemsRouter = Router();

// PUT = idempotent "set stock to quantity in payload": calling it twice gives the same state.
itemsRouter.put(
  "/:sku",
  validate({ params: SkuParams, body: InitBody }),
  asyncHandler(async (req, res) => {
    const item = await inventoryService.initializeStock({
      sku: req.params.sku,
      quantity: req.body.quantity,
    });
    res.status(200).json({ data: item });
  }),
);

itemsRouter.get(
  "/:sku",
  validate({ params: SkuParams }),
  asyncHandler(async (req, res) => {
    res.json({ data: await inventoryService.getStock(req.params.sku) });
  }),
);

itemsRouter.post(
  "/:sku/reservations",
  validate({ params: SkuParams, body: ReserveBody }),
  asyncHandler(async (req, res) => {
    // DEMO ONLY: lets the comparison script switch strategy per request.
    // PRODUCTION: the strategy is fixed by config and this header is ignored.
    const requested = req.get("x-reservation-strategy") as
      | StrategyName
      | undefined;
    const strategyName =
      requested && STRATEGY_NAMES.includes(requested)
        ? requested
        : config.strategy;

    const result = await reservationService.reserve({
      sku: req.params.sku,
      userId: req.body.userId,
      quantity: req.body.quantity,
      idempotencyKey: req.get("idempotency-key") ?? undefined,
      strategyName,
    });
    const { reservation: r } = result;
    // 201 for a new reservation, 200 when replaying an idempotent retry.
    res.status(result.replayed ? 200 : 201).json({
      data: {
        id: r.id,
        itemId: r.itemId.toString(),
        userId: r.userId,
        requestedQuantity: r.requestedQuantity,
        // quantity units actually granted
        quantity: r.quantity,
        partial: r.quantity < r.requestedQuantity,
        remaining: result.remaining,
      },
      meta: { replayed: result.replayed, strategy: strategyName },
    });
  }),
);

// High-throughput path: the stock decision is made in Redis and the reservation is written to
// Postgres in batches after. 202 = accepted means the reservation was completed, 200 means idempotent replay.
itemsRouter.post(
  "/:sku/reservations/fast",
  validate({ params: SkuParams, body: ReserveBody }),
  asyncHandler(async (req, res) => {
    const { grant, replayed } = await reserveFast({
      sku: req.params.sku,
      userId: req.body.userId,
      quantity: req.body.quantity,
      idempotencyKey: req.get("idempotency-key") ?? undefined,
    });
    res.status(replayed ? 200 : 202).json({
      data: {
        id: grant.reservationId,
        userId: req.body.userId,
        requestedQuantity: grant.requested,
        quantity: grant.granted, // units actually granted
        partial: grant.granted < grant.requested,
        remaining: replayed ? undefined : grant.remaining,
      },
      meta: { replayed, path: "redis-gate" },
    });
  }),
);
