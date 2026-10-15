// --- Reservation strategies -------------------------------------------------
export const STRATEGY_NAMES = ["atomic", "pessimistic", "naive"] as const;
export const DEFAULT_STRATEGY = "atomic";

// --- Postgres / Prisma error codes -----------------------------------------
export const UNIQUE_VIOLATION = "23505"; // Postgres unique_violation
export const CHECK_VIOLATION = "23514"; // Postgres check_violation
export const PRISMA_RAW_QUERY_FAILED = "P2010"; // raw query failed
export const PRISMA_TX_TIMEOUT = "P2028"; // interactive transaction timed out

// --- API error codes ---------------------------------------------------------
export const ERROR_CODES = {
  NOT_FOUND: "NOT_FOUND",
  OUT_OF_STOCK: "OUT_OF_STOCK",
  VALIDATION_ERROR: "VALIDATION_ERROR",
  INVALID_JSON: "INVALID_JSON",
  DB_BUSY: "DB_BUSY",
  INTERNAL_ERROR: "INTERNAL_ERROR",
  GATE_UNAVAILABLE: "GATE_UNAVAILABLE",
  WRITES_PENDING: "WRITES_PENDING",
} as const;

// --- Server / DB defaults -----------------------------------------------------
export const DEFAULT_PORT = 3000;
export const DEFAULT_DB_POOL_MAX = 20;
export const DEFAULT_DATABASE_URL = "postgresql://postgres:postgres@localhost:5433/stock";
export const DB_POOL_TIMEOUT_SECONDS = 30;
// Prisma interactive transactions default to maxWait=2s / timeout=5s. With 200 requests
// queued on 20 connections that is too tight, so I've increased it.
export const TX_MAX_WAIT_MS = 10_000;
export const TX_TIMEOUT_MS = 10_000;
export const SHUTDOWN_TIMEOUT_MS = 10_000;

// --- Redis gate (high-throughput path) -----------------------------------------
export const DEFAULT_REDIS_URL = "redis://localhost:6380";
export const REDIS_COMMAND_TIMEOUT_MS = 2_000;
export const STOCK_KEY_PREFIX = "stock:"; // stock:{sku}      -> remaining units
export const IDEMPOTENCY_KEY_PREFIX = "idem:"; // idem:{sku}:{key} -> original result
export const IDEMPOTENCY_TTL_SECONDS = 86_400;
export const RESERVATION_STREAM = "reservations:stream"; // accepted reservations waiting for Postgres
export const RESERVATION_DEAD_STREAM = "reservations:dead"; // entries Postgres rejected
export const WRITER_GROUP = "reservation-writers";
export const WRITER_BATCH_SIZE = 500;
export const WRITER_BLOCK_MS = 1_000;
export const WRITER_CLAIM_IDLE_MS = 5_000;
export const WRITER_CLAIM_INTERVAL_MS = 2_000;
export const WRITER_ERROR_BACKOFF_MS = 1_000;
export const DRAIN_TIMEOUT_MS = 10_000;
export const DRAIN_POLL_MS = 50;
