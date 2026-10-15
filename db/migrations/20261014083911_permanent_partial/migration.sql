/*
  Warnings:

  - You are about to drop the column `status` on the `reservations` table. All the data in the column will be lost.
  - Added the required column `requested_quantity` to the `reservations` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "reservations" DROP COLUMN "status",
ADD COLUMN     "requested_quantity" INTEGER NOT NULL;

-- DropEnum
DROP TYPE "ReservationStatus";

-- A grant can never exceed what was requested (and quantity > 0 already exists).
ALTER TABLE "reservations"
  ADD CONSTRAINT "chk_reservations_granted_le_requested" CHECK ("requested_quantity" >= "quantity");
