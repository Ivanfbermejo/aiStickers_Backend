-- Additional fields required by the domain entities for parity between
-- JSON and PostgreSQL persistence (T05B).

ALTER TABLE "stickers"
  ADD COLUMN "errorMessage" TEXT;

ALTER TABLE "purchases"
  ADD COLUMN "metadata" JSONB NOT NULL DEFAULT '{}';
