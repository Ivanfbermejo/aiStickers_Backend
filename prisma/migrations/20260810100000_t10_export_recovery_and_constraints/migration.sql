-- T10 — Recoverable Telegram export + cross-tenant ownership guards.

-- Status lifecycle for Telegram pack links.
CREATE TYPE "TelegramPackLinkStatus" AS ENUM (
  'PENDING',
  'ACTIVE',
  'FAILED'
);

ALTER TABLE "telegram_pack_links"
  ADD COLUMN "status" "TelegramPackLinkStatus" DEFAULT 'PENDING';

UPDATE "telegram_pack_links"
  SET "status" = 'ACTIVE'
  WHERE "status" IS NULL;

ALTER TABLE "telegram_pack_links"
  ALTER COLUMN "status" SET NOT NULL;

-- Ensure a telegram_pack_links row can only reference a package that really
-- belongs to the same local user. PostgreSQL CHECK constraints cannot use
-- subqueries, so we use a trigger to enforce the cross-table rule.
CREATE OR REPLACE FUNCTION enforce_telegram_pack_link_owner()
RETURNS TRIGGER AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM "packages"
    WHERE "id" = NEW."packageId" AND "userId" = NEW."userId"
  ) THEN
    RAISE EXCEPTION 'TelegramPackLink package owner mismatch';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS telegram_pack_link_owner_check ON "telegram_pack_links";
CREATE TRIGGER telegram_pack_link_owner_check
  BEFORE INSERT OR UPDATE ON "telegram_pack_links"
  FOR EACH ROW
  EXECUTE FUNCTION enforce_telegram_pack_link_owner();

-- Same guarantee for stickers: a sticker can only be linked to a package
-- owned by the sticker's user.
CREATE OR REPLACE FUNCTION enforce_sticker_package_owner()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW."packageId" IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM "packages"
    WHERE "id" = NEW."packageId" AND "userId" = NEW."userId"
  ) THEN
    RAISE EXCEPTION 'Sticker package owner mismatch';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS sticker_package_owner_check ON "stickers";
CREATE TRIGGER sticker_package_owner_check
  BEFORE INSERT OR UPDATE ON "stickers"
  FOR EACH ROW
  EXECUTE FUNCTION enforce_sticker_package_owner();
