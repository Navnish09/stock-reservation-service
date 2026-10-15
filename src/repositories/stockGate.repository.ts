import { randomUUID } from "node:crypto";
import type { Redis } from "ioredis";
import {
  DRAIN_POLL_MS,
  IDEMPOTENCY_KEY_PREFIX,
  IDEMPOTENCY_TTL_SECONDS,
  RESERVATION_STREAM,
  STOCK_KEY_PREFIX,
} from "../config/constants";
import { redis } from "../db/redis";
import type { FastGrant, FastReserveInput, GateResult } from "../types";

// The Redis "gate": decides who gets stock in memory, so Postgres only sees the accepted reservations.
//
// ONE Lua script = one atomic step, Redis runs scripts without interrupting other commands:
//   replay check -> read stock -> granted = min(stock, requested) -> DECRBY -> XADD to the
//   stream -> remember the result under the idempotency key.
// Because the decrement and the enqueue happen inside the same script, a reservation can never be
// lost between "stock reduced" and "queued for Postgres", and stock can never go below zero.
//
// KEYS: [1] stock key  [2] idempotency key  [3] stream
// ARGV: [1] requested  [2] reservation id  [3] userId  [4] sku  [5] idempotency key ("" if none)  [6] ttl seconds
const RESERVE_SCRIPT = `
local idem = ARGV[5]
if idem ~= "" then
  local previous = redis.call("GET", KEYS[2])
  if previous then return {"REPLAY", previous} end
end
local stock = redis.call("GET", KEYS[1])
if not stock then return {"NO_STOCK_KEY"} end
stock = tonumber(stock)
if stock <= 0 then return {"SOLD_OUT"} end
local requested = tonumber(ARGV[1])
local granted = math.min(stock, requested)
local remaining = redis.call("DECRBY", KEYS[1], granted)
redis.call("XADD", KEYS[3], "*", "id", ARGV[2], "sku", ARGV[4], "userId", ARGV[3],
           "requested", ARGV[1], "granted", granted, "idem", idem)
local result = cjson.encode({reservationId = ARGV[2], requested = requested, granted = granted, remaining = remaining})
if idem ~= "" then redis.call("SET", KEYS[2], result, "EX", ARGV[6]) end
return {"OK", result}
`;

type GateRedis = Redis & {
  gateReserve(...args: (string | number)[]): Promise<[string, string?]>;
};
redis.defineCommand("gateReserve", { numberOfKeys: 3, lua: RESERVE_SCRIPT });
const gate = redis as GateRedis;

const stockKey = (sku: string) => `${STOCK_KEY_PREFIX}${sku}`;
const idemKey = (sku: string, key: string) => `${IDEMPOTENCY_KEY_PREFIX}${sku}:${key}`;

export async function tryReserve(input: FastReserveInput): Promise<GateResult> {
  const { sku, userId, quantity, idempotencyKey } = input;
  const [outcome, payload] = await gate.gateReserve(
    stockKey(sku),
    idemKey(sku, idempotencyKey ?? "-"),
    RESERVATION_STREAM,
    quantity,
    randomUUID(),
    userId,
    sku,
    idempotencyKey ?? "",
    IDEMPOTENCY_TTL_SECONDS,
  );
  if (outcome === "OK" || outcome === "REPLAY") {
    return { outcome, grant: JSON.parse(payload as string) as FastGrant };
  }
  return { outcome: outcome as "SOLD_OUT" | "NO_STOCK_KEY" };
}

// Seed the counter only if it does not exist yet, so concurrent first requests can't overwrite each other.
export async function seedStock(sku: string, available: number): Promise<void> {
  await redis.set(stockKey(sku), available, "NX");
}

export async function getStock(sku: string): Promise<number | null> {
  const value = await redis.get(stockKey(sku));
  return value === null ? null : Number(value);
}

// Set the counter and forget idempotency results.
export async function resetStock(sku: string, quantity: number): Promise<void> {
  await redis.set(stockKey(sku), quantity);
  const stream = redis.scanStream({ match: `${IDEMPOTENCY_KEY_PREFIX}${sku}:*`, count: 1000 });
  for await (const keys of stream as AsyncIterable<string[]>) {
    if (keys.length) await redis.unlink(...keys);
  }
}

// Accepted reservations not yet written to Postgres. Acked entries are deleted, so XLEN is the backlog.
export function pendingWrites(): Promise<number> {
  return redis.xlen(RESERVATION_STREAM);
}

// Resolves true once the backlog is empty, false if it is still non-empty after `timeoutMs`.
export async function waitForDrain(timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if ((await pendingWrites()) === 0) return true;
    await new Promise((r) => setTimeout(r, DRAIN_POLL_MS));
  }
  return (await pendingWrites()) === 0;
}
