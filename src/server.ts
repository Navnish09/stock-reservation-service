import { createApp } from "./app";
import { config } from "./config";
import { SHUTDOWN_TIMEOUT_MS } from "./config/constants";
import { prisma } from "./db/prisma";
import { redis } from "./db/redis";
import { startReservationWriter } from "./services/reservationWriter.service";

const server = createApp().listen(config.port, () => {
  console.log(`listening on :${config.port} (strategy=${config.strategy}, pool=${config.dbPoolMax})`);
});

const writer = config.runWriter ? startReservationWriter() : null;

// Graceful shutdown: stop accepting requests, close DB pool.
const shutdown = (signal: string) => {
  console.log(`${signal} received, shutting down`);
  server.close(async () => {
    await writer?.stop();
    redis.disconnect();
    await prisma.$disconnect();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), SHUTDOWN_TIMEOUT_MS).unref();
};
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
