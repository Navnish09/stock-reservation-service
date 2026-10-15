import type { ErrorRequestHandler } from "express";
import { Prisma } from "@prisma/client";
import { ZodError } from "zod";
import { CHECK_VIOLATION, ERROR_CODES, PRISMA_TX_TIMEOUT } from "../config/constants";
import { AppError, pgErrorCode } from "../lib/errors";

// One place that turns any thrown error into a consistent JSON error response.
export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  if (err instanceof AppError) {
    return res.status(err.statusCode).json({
      error: { code: err.code, message: err.message, details: err.details },
    });
  }
  if (err instanceof ZodError) {
    return res.status(400).json({
      error: { code: ERROR_CODES.VALIDATION_ERROR, message: "Invalid request", details: err.flatten().fieldErrors },
    });
  }
  if (err.type === "entity.parse.failed") {
    return res.status(400).json({ error: { code: ERROR_CODES.INVALID_JSON, message: "Malformed JSON body" } });
  }
  
  if (pgErrorCode(err) === CHECK_VIOLATION) {
    return res.status(409).json({ error: { code: ERROR_CODES.OUT_OF_STOCK, message: "Stock constraint violated" } });
  }
  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === PRISMA_TX_TIMEOUT) {
    return res.status(503).json({ error: { code: ERROR_CODES.DB_BUSY, message: "Database busy, retry later" } });
  }
  console.error("[unhandled]", req.method, req.path, err);
  return res.status(500).json({ error: { code: ERROR_CODES.INTERNAL_ERROR, message: "Unexpected error" } });
};
