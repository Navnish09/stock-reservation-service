import { PrismaClient } from "@prisma/client";
import { config } from "../config";
import { DB_POOL_TIMEOUT_SECONDS } from "../config/constants";

// One client per process. 200 concurrent HTTP requests do NOT
// get 200 DB connections — they queue for one of `connection_limit`.
const url = new URL(config.databaseUrl);
url.searchParams.set("connection_limit", String(config.dbPoolMax));
url.searchParams.set("pool_timeout", String(DB_POOL_TIMEOUT_SECONDS));

export const prisma = new PrismaClient({ datasourceUrl: url.toString() });
