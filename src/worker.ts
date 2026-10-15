// Standalone writer: `npm run worker`. Use it to scale writers separately from the API
// start the API with RUN_WRITER=false to run the writer separately.
import { prisma } from "./db/prisma";
import { redis } from "./db/redis";
import { startReservationWriter } from "./services/reservationWriter.service";

const writer = startReservationWriter();

const shutdown = async (signal: string) => {
  console.log(`${signal} received, stopping writer`);
  await writer.stop();
  redis.disconnect();
  await prisma.$disconnect();
  process.exit(0);
};
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
