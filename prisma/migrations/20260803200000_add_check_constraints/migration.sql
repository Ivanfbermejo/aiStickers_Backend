-- Business-rule CHECK constraints that Prisma's schema language cannot
-- express declaratively (see docs/data-model.md for rationale).

-- Balances can never go negative and are always whole StickerDollars.
ALTER TABLE "balances"
  ADD CONSTRAINT "balances_stickerDollars_nonnegative" CHECK ("stickerDollars" >= 0),
  ADD CONSTRAINT "balances_totalPurchased_nonnegative" CHECK ("totalPurchased" >= 0),
  ADD CONSTRAINT "balances_totalSpent_nonnegative" CHECK ("totalSpent" >= 0),
  ADD CONSTRAINT "balances_version_nonnegative" CHECK ("version" >= 0);

-- Every ledger movement is a positive magnitude; direction is carried by
-- "type". The resulting balance snapshot can never be negative either.
ALTER TABLE "ledger_entries"
  ADD CONSTRAINT "ledger_entries_amount_positive" CHECK ("amount" > 0),
  ADD CONSTRAINT "ledger_entries_balanceAfter_nonnegative" CHECK ("balanceAfter" >= 0);

-- A purchase always grants a positive amount of StickerDollars.
ALTER TABLE "purchases"
  ADD CONSTRAINT "purchases_stickerAmount_positive" CHECK ("stickerAmount" > 0);

-- Denormalized counters/costs can never be negative.
ALTER TABLE "packages"
  ADD CONSTRAINT "packages_stickerCount_nonnegative" CHECK ("stickerCount" >= 0);

ALTER TABLE "stickers"
  ADD CONSTRAINT "stickers_cost_positive" CHECK ("cost" > 0),
  ADD CONSTRAINT "stickers_width_positive" CHECK ("width" IS NULL OR "width" > 0),
  ADD CONSTRAINT "stickers_height_positive" CHECK ("height" IS NULL OR "height" > 0),
  ADD CONSTRAINT "stickers_durationMs_nonnegative" CHECK ("durationMs" IS NULL OR "durationMs" >= 0),
  ADD CONSTRAINT "stickers_sizeBytes_nonnegative" CHECK ("sizeBytes" IS NULL OR "sizeBytes" >= 0);

ALTER TABLE "generation_jobs"
  ADD CONSTRAINT "generation_jobs_cost_positive" CHECK ("cost" > 0),
  ADD CONSTRAINT "generation_jobs_attempts_nonnegative" CHECK ("attempts" >= 0),
  ADD CONSTRAINT "generation_jobs_progress_range" CHECK ("progress" >= 0 AND "progress" <= 100);
