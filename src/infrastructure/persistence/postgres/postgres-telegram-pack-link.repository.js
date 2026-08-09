import { TelegramPackLink } from '../../../domain/entities/telegram-pack-link.entity.js';
import { ITelegramPackLinkRepository } from '../../../domain/repositories/telegram-pack-link.repository.js';
import { getPrismaClient } from '../prisma/client.js';

function toLink(raw) {
  if (!raw) return null;
  return new TelegramPackLink({
    id: raw.id,
    userId: raw.userId,
    telegramUserId: raw.telegramUserId,
    packageId: raw.packageId,
    setName: raw.setName,
    stickerFileIds: raw.stickerFileIds || {},
    createdAt: raw.createdAt.toISOString(),
    updatedAt: raw.updatedAt.toISOString()
  });
}

function toData(link) {
  return {
    id: link.id,
    userId: link.userId,
    telegramUserId: link.telegramUserId,
    packageId: link.packageId,
    setName: link.setName,
    stickerFileIds: link.stickerFileIds,
    createdAt: new Date(link.createdAt),
    updatedAt: new Date(link.updatedAt)
  };
}

export class PostgresTelegramPackLinkRepository extends ITelegramPackLinkRepository {
  async findByUserIdAndPackageId(userId, packageId) {
    const raw = await getPrismaClient().telegramPackLink.findFirst({ where: { userId, packageId } });
    return toLink(raw);
  }

  async findBySetName(setName, userId) {
    const raw = await getPrismaClient().telegramPackLink.findFirst({
      where: { setName, ...(userId ? { userId } : {}) }
    });
    return toLink(raw);
  }

  async save(link) {
    const prisma = getPrismaClient();
    const data = toData(link);
    await prisma.telegramPackLink.upsert({
      where: { id: link.id },
      update: { ...data, id: undefined },
      create: data
    });
    return link;
  }

  async update(link, userId = link?.userId) {
    const data = toData(link);
    const result = await getPrismaClient().telegramPackLink.updateMany({
      where: { id: link.id, ...(userId ? { userId } : {}) },
      data: { ...data, id: undefined }
    });
    return result.count > 0 ? link : false;
  }

  async deleteByPackageId(packageId, userId) {
    const result = await getPrismaClient().telegramPackLink.deleteMany({
      where: { packageId, ...(userId ? { userId } : {}) }
    });
    return result.count;
  }
}
