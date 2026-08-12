-- T10 — Persist the local sticker order used for a Telegram export attempt
-- so a later recovery (after a timeout/ambiguous result) can deterministically
-- rebuild the localId -> Telegram file_id map.

ALTER TABLE "telegram_pack_links"
  ADD COLUMN "stickerIdOrder" JSONB NOT NULL DEFAULT '[]';
