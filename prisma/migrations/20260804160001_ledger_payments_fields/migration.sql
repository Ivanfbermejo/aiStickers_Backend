-- T06 — Ledger, saldo y pagos: reconciler fields and new default status.

-- New purchases start as RECEIVED until the provider confirms them.
ALTER TABLE "purchases" ALTER COLUMN "status" SET DEFAULT 'RECEIVED';

-- Reconciler bookkeeping for pending purchases.
ALTER TABLE "purchases" ADD COLUMN "reconciledAt" TIMESTAMP(3);
ALTER TABLE "purchases" ADD COLUMN "reconcileAttempts" INTEGER NOT NULL DEFAULT 0;

-- Index to efficiently find pending purchases ordered by retry eligibility.
CREATE INDEX "purchases_status_reconcileAttempts_createdAt_idx" ON "purchases"("status", "reconcileAttempts", "createdAt");
