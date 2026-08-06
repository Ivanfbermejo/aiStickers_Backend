-- T07 — Almacenamiento privado de assets: metadatos de objeto para stickers y paquetes.

ALTER TABLE "stickers"
  ADD COLUMN "objectHash" TEXT,
  ADD COLUMN "objectSize" INTEGER,
  ADD COLUMN "objectMime" TEXT,
  ADD COLUMN "objectWidth" INTEGER,
  ADD COLUMN "objectHeight" INTEGER,
  ADD COLUMN "whatsappObjectKey" TEXT,
  ADD COLUMN "whatsappObjectHash" TEXT,
  ADD COLUMN "whatsappObjectSize" INTEGER,
  ADD COLUMN "whatsappObjectMime" TEXT,
  ADD COLUMN "whatsappObjectWidth" INTEGER,
  ADD COLUMN "whatsappObjectHeight" INTEGER;

ALTER TABLE "packages"
  ADD COLUMN "trayIconObjectKey" TEXT,
  ADD COLUMN "trayIconObjectHash" TEXT,
  ADD COLUMN "trayIconObjectSize" INTEGER,
  ADD COLUMN "trayIconObjectMime" TEXT,
  ADD COLUMN "trayIconObjectWidth" INTEGER,
  ADD COLUMN "trayIconObjectHeight" INTEGER;
