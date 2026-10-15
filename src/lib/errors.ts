import { Prisma } from "@prisma/client";
import { ERROR_CODES, PRISMA_RAW_QUERY_FAILED } from "../config/constants";

export class AppError extends Error {
  constructor(
    public code: string,
    message: string,
    public statusCode = 400,
    public details?: unknown,
  ) {
    super(message);
  }
}

export const Errors = {
  notFound: (what: string) => new AppError(ERROR_CODES.NOT_FOUND, `${what} not found`, 404),

  outOfStock: () => new AppError(ERROR_CODES.OUT_OF_STOCK, "Item is sold out", 409),
  gateUnavailable: () =>
    new AppError(ERROR_CODES.GATE_UNAVAILABLE, "Reservation gate (Redis) is unavailable, retry later", 503),
  writesPending: () =>
    new AppError(ERROR_CODES.WRITES_PENDING, "Accepted reservations are still being written, retry shortly", 409),
};

// Postgres error code (e.g. "23505" unique, "23514" check) behind a query failure.
export function pgErrorCode(err: unknown): string | undefined {
  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === PRISMA_RAW_QUERY_FAILED) {
    return String(err.meta?.code);
  }
  return undefined;
}
