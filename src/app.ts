import express from "express";
import { prisma } from "./db/prisma";
import { redis } from "./db/redis";
import { itemsRouter } from "./routes/items.routes";
import { errorHandler } from "./middleware/errorHandler";

export function createApp() {
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "10kb" }));

  app.get("/health", async (_req, res, next) => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      // Redis only powers the /reservations/fast endpoint. the other endpoints work without it.
      const gate = await redis.ping().then(() => "up", () => "down");
      res.json({ status: "ok", redis: gate });
    } catch (err) {
      next(err);
    }
  });

  app.use("/api/v1/items", itemsRouter);

  app.use((_req, res) => res.status(404).json({ error: { code: "NOT_FOUND", message: "Route not found" } }));
  app.use(errorHandler);
  return app;
}
