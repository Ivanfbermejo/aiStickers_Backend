-- T06 — Ledger, saldo y pagos: extend purchase lifecycle statuses.

-- Expand the purchase status enum to cover the full lifecycle.
-- These values are committed in their own migration so the next migration can
-- use them as defaults/index values safely.
ALTER TYPE "PurchaseStatus" ADD VALUE 'RECEIVED';
ALTER TYPE "PurchaseStatus" ADD VALUE 'CREDITED';
ALTER TYPE "PurchaseStatus" ADD VALUE 'REJECTED';
ALTER TYPE "PurchaseStatus" ADD VALUE 'REFUNDED';
