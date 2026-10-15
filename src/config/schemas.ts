import z from "zod";

export const SkuParams = z.object({ sku: z.string().trim().min(1).max(64) });

export const InitBody = z.object({
  quantity: z.number().int().min(0).max(1_000_000).default(100),
});

export const ReserveBody = z.object({
  userId: z.string().trim().min(1).max(100),
  quantity: z.number().int().positive().max(1_000),
});
