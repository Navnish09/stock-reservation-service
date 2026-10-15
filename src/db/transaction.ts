import { config } from "../config";
import type { Tx } from "../types";
import { prisma } from "./prisma";

export function withTransaction<T>(work: (tx: Tx) => Promise<T>): Promise<T> {
  return prisma.$transaction(work, { maxWait: config.txMaxWaitMs, timeout: config.txTimeoutMs });
}
