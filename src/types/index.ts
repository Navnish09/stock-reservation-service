// All shared types live here. Constants live in src/config/constants.ts.
import type { Prisma, PrismaClient, Reservation } from "@prisma/client";
import type { STRATEGY_NAMES } from "../config/constants";

export type StrategyName = (typeof STRATEGY_NAMES)[number];

// Transaction client handed to the callback of prisma.$transaction.
export type Tx = Prisma.TransactionClient;

// Either the prisma client (standalone query) or a transaction client (part of a unit of work).
export type Db = Tx | PrismaClient;

// Strategy pattern: every strategy exposes the same contract
//   decrementStock(tx, itemId, requested) -> { granted, remaining } | null
// `granted` may be LESS than `requested` (partial fulfilment); null means sold out (0 left).
export interface Grant {
  granted: number;
  remaining: number;
}
export type DecrementStock = (tx: Tx, itemId: bigint, requested: number) => Promise<Grant | null>;

export interface ReserveInput {
  sku: string;
  userId: string;
  quantity: number;
  idempotencyKey?: string;
  strategyName: StrategyName;
}

export interface ReserveResult {
  reservation: Reservation;
  remaining?: number;
  replayed: boolean;
}

export interface ItemStats {
  reservationCount: number;
  reservedQuantity: number;
  distinctUsers: number;
}

export interface LoadTestOptions {
  base: string;
  users: number;
  stock: number;
  qty: string; // number, or "random" (1-3)
  sku: string;
  strategy?: string; // optional, demo override
  endpoint: "standard" | "fast"; // fast = Redis gate path (POST .../reservations/fast)
  concurrency: number; // max in-flight requests (a pool, so 10k+ users don't open 10k sockets at once)
  quiet: boolean;
}

// Outcome of one reservation request sent by the load test.
export interface RequestResult {
  requested: number;
  granted: number; // units actually granted (0 when rejected, less than `requested` on a partial fill)
  status: number;
  code?: string; // API error code, e.g. OUT_OF_STOCK
  ms: number;
}

// The part of GET /items/:sku that the load test reads.
export interface StockSnapshot {
  sku: string;
  totalQuantity: number;
  available: number;
  reservedQuantity: number;
  consistent: boolean;
  gate: { available: number | null; pendingWrites: number } | null; // null when Redis is down
}

export interface LoadTestSummary {
  strategy: string;
  users: number;
  stock: number;
  succeeded: number; // accepted reservations
  partials: number;
  unitsConfirmed: number; // units the clients were told they got
  unitsReserved: number; // units the server ledger says were reserved
  available: number;
  statuses: Record<string, number>;
  wallMs: number;
  rps: number;
  drainMs: number;
  p50ms: number;
  p95ms: number;
  p99ms: number;
  passed: boolean;
  checks: [string, boolean][];
}

// --- Redis gate (high-throughput path) -----------------------------------------
export interface FastGrant {
  reservationId: string;
  requested: number;
  granted: number; // may be less than `requested` (partial fulfilment)
  remaining: number;
}

export type GateResult =
  | { outcome: "OK" | "REPLAY"; grant: FastGrant }
  | { outcome: "SOLD_OUT" | "NO_STOCK_KEY" };

export interface FastReserveInput {
  sku: string;
  userId: string;
  quantity: number;
  idempotencyKey?: string;
}

export interface FastReserveResult {
  grant: FastGrant;
  replayed: boolean;
}

// One accepted reservation as stored in the Redis stream.
export interface StreamEntry {
  streamId: string;
  id: string;
  sku: string;
  userId: string;
  requested: number;
  granted: number;
  idem: string | null;
}
