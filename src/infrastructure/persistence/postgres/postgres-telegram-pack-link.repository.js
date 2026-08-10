import { TelegramPackLink } from '../../../domain/entities/telegram-pack-link.entity.js';
import { ITelegramPackLinkRepository } from '../../../domain/repositories/telegram-pack-link.repository.js';
import { getPrismaClient } from '../prisma/client.js';

function fromStatus(status) {
  return status ? status.toLowerCase() : 'pending';
}

function toStatus(status) {
  return status ? status.toUpperCase() : 'PENDING';
}

function toLink(raw) {
  if (!raw) return null;
  return new TelegramPackLink({
    id: raw.id,
    userId: raw.userId,
    telegramUserId: raw.telegramUserId,
    packageId: raw.packageId,
    setName: raw.setName,
    status: fromStatus(raw.status),
    stickerFileIds: raw.stickerFileIds || {},
    stickerIdOrder: raw.stickerIdOrder || [],
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
    status: toStatus(link.status),
    stickerFileIds: link.stickerFileIds,
    stickerIdOrder: link.stickerIdOrder,
    createdAt: new Date(link.createdAt),
    updatedAt: new Date(link.updatedAt)
  };
}

async function assertPackageOwnership(prisma, userId, packageId) {
  const pkg = await prisma.package.findUnique({
    where: { id: packageId },
    select: { userId: true }
  });
  if (!pkg || pkg.userId !== userId) {
    throw new Error('TelegramPackLink package owner mismatch');
  }
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
    await prisma.$transaction(async (tx) => {
      await assertPackageOwnership(tx, link.userId, link.packageId);
      const data = toData(link);
      await tx.telegramPackLink.upsert({
        where: { id: link.id },
        update: { ...data, id: undefined },
        create: data
      });
    });
    return link;
  }

  async update(link, userId = link?.userId) {
    const prisma = getPrismaClient();
    let result;
    await prisma.$transaction(async (tx) => {
      await assertPackageOwnership(tx, link.userId, link.packageId);
      const data = toData(link);
      result = await tx.telegramPackLink.updateMany({
        where: { id: link.id, ...(userId ? { userId } : {}) },
        data: { ...data, id: undefined }
      });
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
