-- The version column only served the removed optimistic strategy.
ALTER TABLE "items" DROP COLUMN "version";
