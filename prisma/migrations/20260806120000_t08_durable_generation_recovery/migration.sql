-- T08 — Durable PostgreSQL cleanup tasks.

CREATE TYPE "AssetCleanupTaskStatus" AS ENUM (
  'PENDING',
  'CONFIRMED',
  'QUEUED',
  'PROCESSING',
  'FAILED',
  'COMPLETED',
  'CANCELLED'
);

CREATE TABLE "asset_cleanup_tasks" (
  "id" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "ownerId" TEXT NOT NULL,
  "entity" TEXT NOT NULL,
  "status" "AssetCleanupTaskStatus" NOT NULL DEFAULT 'PENDING',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "confirmedAt" TIMESTAMP(3),
  "queuedAt" TIMESTAMP(3),
  "lockedAt" TIMESTAMP(3),
  "lastAttemptAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "lastError" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "asset_cleanup_tasks_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "asset_cleanup_tasks_ownerId_key_key"
  ON "asset_cleanup_tasks"("ownerId", "key");
CREATE INDEX "asset_cleanup_tasks_status_lockedAt_confirmedAt_idx"
  ON "asset_cleanup_tasks"("status", "lockedAt", "confirmedAt");
