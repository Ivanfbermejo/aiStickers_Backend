-- T10 — Persisted, ownership-scoped Telegram sticker-set links.

CREATE TABLE "telegram_pack_links" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "telegramUserId" TEXT NOT NULL,
  "packageId" TEXT NOT NULL,
  "setName" TEXT NOT NULL,
  "stickerFileIds" JSONB NOT NULL DEFAULT '{}',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "telegram_pack_links_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "telegram_pack_links_setName_key"
  ON "telegram_pack_links"("setName");
CREATE UNIQUE INDEX "telegram_pack_links_userId_packageId_key"
  ON "telegram_pack_links"("userId", "packageId");
CREATE INDEX "telegram_pack_links_userId_telegramUserId_idx"
  ON "telegram_pack_links"("userId", "telegramUserId");
CREATE INDEX "telegram_pack_links_packageId_idx"
  ON "telegram_pack_links"("packageId");

ALTER TABLE "telegram_pack_links"
  ADD CONSTRAINT "telegram_pack_links_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "telegram_pack_links"
  ADD CONSTRAINT "telegram_pack_links_packageId_fkey"
  FOREIGN KEY ("packageId") REFERENCES "packages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "generation_jobs_providerPredictionId_idx"
  ON "generation_jobs"("providerPredictionId");
