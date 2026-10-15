import Redis from "ioredis";
import { config } from "../config";
import { REDIS_COMMAND_TIMEOUT_MS } from "../config/constants";

// When Redis is down, commands give up after REDIS_COMMAND_TIMEOUT_MS instead of hanging forever,
// so the fast endpoint throws 503 and the Postgres endpoints keep working.
export function createRedis(): Redis {
  const client = new Redis(config.redisUrl, {
    maxRetriesPerRequest: 1,
    commandTimeout: REDIS_COMMAND_TIMEOUT_MS,
  });
  let lastLog = 0;
  client.on("error", (err) => {
    if (Date.now() - lastLog > 5_000) {
      lastLog = Date.now();
      console.error("[redis]", err.message);
    }
  });
  return client;
}

// Shared client for request handling. Blocking commands (XREADGROUP BLOCK) must NOT use it,
// because a blocked connection would block every other commands, that's why the writer duplicates this redis client.
export const redis = createRedis();
