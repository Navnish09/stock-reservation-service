import { existsSync } from "node:fs";
import {
  DEFAULT_DATABASE_URL,
  DEFAULT_DB_POOL_MAX,
  DEFAULT_PORT,
  DEFAULT_REDIS_URL,
  DEFAULT_STRATEGY,
  STRATEGY_NAMES,
  TX_MAX_WAIT_MS,
  TX_TIMEOUT_MS,
} from "./constants";
import type { StrategyName } from "../types";

// Load .env so the app and the Prisma CLI use the same settings.
// Variables that are already set in the environment take priority over the file.
if (existsSync(".env")) process.loadEnvFile();

const strategy = (process.env.RESERVATION_STRATEGY ?? DEFAULT_STRATEGY) as StrategyName;
if (!STRATEGY_NAMES.includes(strategy)) {
  throw new Error(`RESERVATION_STRATEGY must be one of: ${STRATEGY_NAMES.join(", ")}`);
}

export const config = Object.freeze({
  port: Number(process.env.PORT ?? DEFAULT_PORT),
  databaseUrl: process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL,
  dbPoolMax: Number(process.env.DB_POOL_MAX ?? DEFAULT_DB_POOL_MAX),
  redisUrl: process.env.REDIS_URL ?? DEFAULT_REDIS_URL,
  // Run the Redis -> Postgres writer inside the API process.
  runWriter: process.env.RUN_WRITER !== "false",
  txMaxWaitMs: TX_MAX_WAIT_MS,
  txTimeoutMs: TX_TIMEOUT_MS,
  strategy,
});
