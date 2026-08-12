import { Package } from '../../../domain/entities/package.entity.js';
import { IPackageRepository } from '../../../domain/repositories/package.repository.js';
import { getPrismaClient } from '../prisma/client.js';

function toPackType(packType) {
  return packType ? packType.toUpperCase() : 'STATIC';
}

function fromPackType(packType) {
  return packType.toLowerCase();
}

function toExportStatus(status) {
  return status ? status.toUpperCase() : 'PENDING';
}

function fromExportStatus(status) {
  return status.toLowerCase();
}

function toPackage(raw) {
  if (!raw) return null;
  return new Package({
    id: raw.id,
    userId: raw.userId,
    name: raw.name,
    author: raw.author ?? null,
    icon: raw.icon ?? null,
    description: raw.description ?? null,
    isPublic: raw.isPublic,
    stickerCount: raw.stickerCount,
    category: raw.category ?? null,
    tags: raw.tags ?? [],
    platform: raw.platform ?? null,
    packType: fromPackType(raw.packType),
    trayIconUrl: raw.trayIconUrl ?? null,
    trayIconObjectKey: raw.trayIconObjectKey ?? null,
    trayIconObjectHash: raw.trayIconObjectHash ?? null,
    trayIconObjectSize: raw.trayIconObjectSize ?? null,
    trayIconObjectMime: raw.trayIconObjectMime ?? null,
    trayIconObjectWidth: raw.trayIconObjectWidth ?? null,
    trayIconObjectHeight: raw.trayIconObjectHeight ?? null,
    exportStatus: fromExportStatus(raw.exportStatus),
    whatsappReady: raw.whatsappReady,
    exportError: raw.exportError ?? null,
    createdAt: raw.createdAt.toISOString(),
    updatedAt: raw.updatedAt.toISOString()
  });
}

function toPackageData(pkg) {
  return {
    id: pkg.id,
    userId: pkg.userId,
    name: pkg.name,
    author: pkg.author ?? null,
    icon: pkg.icon ?? null,
    description: pkg.description ?? null,
    isPublic: pkg.isPublic ?? false,
    stickerCount: pkg.stickerCount ?? 0,
    category: pkg.category ?? null,
    tags: pkg.tags ?? [],
    platform: pkg.platform ?? null,
    packType: toPackType(pkg.packType),
    trayIconUrl: pkg.trayIconUrl ?? null,
    trayIconObjectKey: pkg.trayIconObjectKey ?? null,
    trayIconObjectHash: pkg.trayIconObjectHash ?? null,
    trayIconObjectSize: pkg.trayIconObjectSize ?? null,
    trayIconObjectMime: pkg.trayIconObjectMime ?? null,
    trayIconObjectWidth: pkg.trayIconObjectWidth ?? null,
    trayIconObjectHeight: pkg.trayIconObjectHeight ?? null,
    exportStatus: toExportStatus(pkg.exportStatus),
    whatsappReady: pkg.whatsappReady ?? false,
    exportError: pkg.exportError ?? null,
    createdAt: new Date(pkg.createdAt),
    updatedAt: new Date(pkg.updatedAt)
  };
}

export class PostgresPackageRepository extends IPackageRepository {
  async findById(id, userId) {
    const raw = await getPrismaClient().package.findFirst({
      where: { id, ...(userId ? { userId } : {}) }
    });
    return toPackage(raw);
  }

  async findPublicById(id) {
    const raw = await getPrismaClient().package.findFirst({ where: { id, isPublic: true } });
    return toPackage(raw);
  }

  async findByUserId(userId) {
    const rows = await getPrismaClient().package.findMany({
      where: { userId },
      orderBy: { updatedAt: 'desc' }
    });
    return rows.map(toPackage);
  }

  async findPublic() {
    const rows = await getPrismaClient().package.findMany({
      where: { isPublic: true },
      orderBy: { updatedAt: 'desc' }
    });
    return rows.map(toPackage);
  }

  async findByCategory(category) {
    const rows = await getPrismaClient().package.findMany({
      where: { category, isPublic: true },
      orderBy: { updatedAt: 'desc' }
    });
    return rows.map(toPackage);
  }

  async findByTag(tag) {
    const rows = await getPrismaClient().package.findMany({
      where: { tags: { has: tag }, isPublic: true },
      orderBy: { updatedAt: 'desc' }
    });
    return rows.map(toPackage);
  }

  async save(pkg) {
    const prisma = getPrismaClient();
    const data = toPackageData(pkg);
    await prisma.package.upsert({
      where: { id: pkg.id },
      update: { ...data, id: undefined },
      create: data
    });
    return pkg;
  }

  async update(pkg, userId = pkg?.userId) {
    const prisma = getPrismaClient();
    const data = toPackageData(pkg);
    const result = await prisma.package.updateMany({
      where: { id: pkg.id, ...(userId ? { userId } : {}) },
      data: { ...data, id: undefined }
    });
    return result.count > 0 ? pkg : false;
  }

  async delete(id, userId) {
    const result = await getPrismaClient().package.deleteMany({
      where: { id, ...(userId ? { userId } : {}) }
    });
    return result.count > 0;
  }

  async deleteByUserId(userId) {
    const result = await getPrismaClient().package.deleteMany({ where: { userId } });
    return result.count;
  }

  async countByUserId(userId) {
    return getPrismaClient().package.count({ where: { userId } });
  }

  async exists(id) {
    const count = await getPrismaClient().package.count({ where: { id } });
    return count > 0;
  }
}
