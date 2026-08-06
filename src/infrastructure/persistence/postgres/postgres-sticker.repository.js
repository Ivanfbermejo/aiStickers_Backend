import { Sticker } from '../../../domain/entities/sticker.entity.js';
import { IStickerRepository } from '../../../domain/repositories/sticker.repository.js';
import { getPrismaClient } from '../prisma/client.js';

function toStickerStatus(status) {
  return status ? status.toUpperCase() : 'PENDING';
}

function fromStickerStatus(status) {
  return status.toLowerCase();
}

function toExportStatus(status) {
  return status ? status.toUpperCase() : 'PENDING';
}

function fromExportStatus(status) {
  return status.toLowerCase();
}

function toSticker(raw) {
  if (!raw) return null;
  return new Sticker({
    id: raw.id,
    userId: raw.userId,
    packageId: raw.packageId ?? null,
    name: raw.name ?? null,
    imageUrl: raw.imageUrl ?? null,
    thumbnailUrl: raw.thumbnailUrl ?? null,
    webpUrl: raw.webpUrl ?? null,
    animatedWebpUrl: raw.animatedWebpUrl ?? null,
    whatsappWebpUrl: raw.whatsappWebpUrl ?? null,
    whatsappObjectKey: raw.whatsappObjectKey ?? null,
    whatsappObjectHash: raw.whatsappObjectHash ?? null,
    replicateId: raw.replicateId ?? null,
    objectKey: raw.objectKey ?? null,
    objectHash: raw.objectHash ?? null,
    objectSize: raw.objectSize ?? null,
    objectMime: raw.objectMime ?? null,
    objectWidth: raw.objectWidth ?? null,
    objectHeight: raw.objectHeight ?? null,
    whatsappObjectSize: raw.whatsappObjectSize ?? null,
    whatsappObjectMime: raw.whatsappObjectMime ?? null,
    whatsappObjectWidth: raw.whatsappObjectWidth ?? null,
    whatsappObjectHeight: raw.whatsappObjectHeight ?? null,
    status: fromStickerStatus(raw.status),
    prompt: raw.prompt ?? null,
    cost: raw.cost,
    width: raw.width ?? null,
    height: raw.height ?? null,
    durationMs: raw.durationMs ?? null,
    sizeBytes: raw.sizeBytes ?? null,
    mimeType: raw.mimeType ?? null,
    exportStatus: fromExportStatus(raw.exportStatus),
    exportError: raw.exportError ?? null,
    errorMessage: raw.errorMessage ?? null,
    createdAt: raw.createdAt.toISOString(),
    updatedAt: raw.updatedAt.toISOString()
  });
}

function toStickerData(sticker) {
  return {
    id: sticker.id,
    userId: sticker.userId,
    packageId: sticker.packageId || null,
    name: sticker.name ?? null,
    imageUrl: sticker.imageUrl ?? null,
    thumbnailUrl: sticker.thumbnailUrl ?? null,
    webpUrl: sticker.webpUrl ?? null,
    animatedWebpUrl: sticker.animatedWebpUrl ?? null,
    whatsappWebpUrl: sticker.whatsappWebpUrl ?? null,
    whatsappObjectKey: sticker.whatsappObjectKey ?? null,
    whatsappObjectHash: sticker.whatsappObjectHash ?? null,
    replicateId: sticker.replicateId ?? null,
    objectKey: sticker.objectKey ?? null,
    objectHash: sticker.objectHash ?? null,
    objectSize: sticker.objectSize ?? null,
    objectMime: sticker.objectMime ?? null,
    objectWidth: sticker.objectWidth ?? null,
    objectHeight: sticker.objectHeight ?? null,
    whatsappObjectSize: sticker.whatsappObjectSize ?? null,
    whatsappObjectMime: sticker.whatsappObjectMime ?? null,
    whatsappObjectWidth: sticker.whatsappObjectWidth ?? null,
    whatsappObjectHeight: sticker.whatsappObjectHeight ?? null,
    status: toStickerStatus(sticker.status),
    prompt: sticker.prompt ?? null,
    cost: sticker.cost,
    width: sticker.width ?? null,
    height: sticker.height ?? null,
    durationMs: sticker.durationMs ?? null,
    sizeBytes: sticker.sizeBytes ?? null,
    mimeType: sticker.mimeType ?? null,
    exportStatus: toExportStatus(sticker.exportStatus),
    exportError: sticker.exportError ?? null,
    errorMessage: sticker.errorMessage ?? null,
    createdAt: new Date(sticker.createdAt),
    updatedAt: new Date(sticker.updatedAt)
  };
}

export class PostgresStickerRepository extends IStickerRepository {
  constructor(prismaClient) {
    super();
    this.prisma = prismaClient;
  }

  _getPrisma(tx) {
    return tx || this.prisma || getPrismaClient();
  }

  withPrisma(prismaClient) {
    return new PostgresStickerRepository(prismaClient);
  }

  async findById(id, tx) {
    const raw = await this._getPrisma(tx).sticker.findUnique({ where: { id } });
    return toSticker(raw);
  }

  async findByUserId(userId, tx) {
    const rows = await this._getPrisma(tx).sticker.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' }
    });
    return rows.map(toSticker);
  }

  async findByPackageId(packageId, tx) {
    const rows = await this._getPrisma(tx).sticker.findMany({
      where: { packageId },
      orderBy: { createdAt: 'desc' }
    });
    return rows.map(toSticker);
  }

  async findByReplicateId(replicateId, tx) {
    const raw = await this._getPrisma(tx).sticker.findFirst({ where: { replicateId } });
    return toSticker(raw);
  }

  async findByUserIdAndStatus(userId, status, tx) {
    const rows = await this._getPrisma(tx).sticker.findMany({
      where: { userId, status: toStickerStatus(status) },
      orderBy: { createdAt: 'desc' }
    });
    return rows.map(toSticker);
  }

  async save(sticker, tx) {
    const prisma = this._getPrisma(tx);
    const data = toStickerData(sticker);
    await prisma.sticker.upsert({
      where: { id: sticker.id },
      update: { ...data, id: undefined },
      create: data
    });
    return sticker;
  }

  async update(sticker, tx) {
    return this.save(sticker, tx);
  }

  async delete(id, tx) {
    await this._getPrisma(tx).sticker.delete({ where: { id } });
    return true;
  }

  async deleteByUserId(userId, tx) {
    const result = await this._getPrisma(tx).sticker.deleteMany({ where: { userId } });
    return result.count;
  }

  async countByUserId(userId, tx) {
    return this._getPrisma(tx).sticker.count({ where: { userId } });
  }

  async countByPackageId(packageId, tx) {
    return this._getPrisma(tx).sticker.count({ where: { packageId } });
  }
}
