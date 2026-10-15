-- CreateEnum
CREATE TYPE "ReservationStatus" AS ENUM ('RESERVED', 'CANCELLED', 'CONFIRMED');

-- CreateTable
CREATE TABLE "items" (
    "id" BIGSERIAL NOT NULL,
    "sku" TEXT NOT NULL,
    "total_quantity" INTEGER NOT NULL,
    "available" INTEGER NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reservations" (
    "id" UUID NOT NULL,
    "item_id" BIGINT NOT NULL,
    "user_id" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "status" "ReservationStatus" NOT NULL DEFAULT 'RESERVED',
    "idempotency_key" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reservations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "items_sku_key" ON "items"("sku");

-- CreateIndex
CREATE UNIQUE INDEX "reservations_idempotency_key_key" ON "reservations"("idempotency_key");

-- CreateIndex
CREATE INDEX "reservations_item_id_idx" ON "reservations"("item_id");

-- CreateIndex
CREATE INDEX "reservations_user_id_idx" ON "reservations"("user_id");

-- AddForeignKey
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Prisma can't express CHECK constraints, so they're added by hand.
-- The DATABASE enforces the invariants: even a buggy code path can't oversell.
ALTER TABLE "items"
  ADD CONSTRAINT "chk_items_total_nonneg" CHECK ("total_quantity" >= 0),
  ADD CONSTRAINT "chk_items_available_range" CHECK ("available" >= 0 AND "available" <= "total_quantity");
ALTER TABLE "reservations"
  ADD CONSTRAINT "chk_reservations_qty_positive" CHECK ("quantity" > 0);
