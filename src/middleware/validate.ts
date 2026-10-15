import type { RequestHandler } from "express";
import type { ZodTypeAny } from "zod";

// Validates req.body / req.params against zod schemas and replaces them with
// the parsed (typed, coerced, stripped) values. To handle bad input.
export const validate =
  (schemas: Partial<Record<"body" | "params", ZodTypeAny>>): RequestHandler =>
  (req, _res, next) => {
    for (const [part, schema] of Object.entries(schemas) as ["body" | "params", ZodTypeAny][]) {
      const result = schema.safeParse(req[part]);
      if (!result.success) return next(result.error);
      req[part] = result.data;
    }
    next();
  };
