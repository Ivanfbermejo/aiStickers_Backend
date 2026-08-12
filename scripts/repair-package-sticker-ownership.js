import { PrismaClient } from '@prisma/client';

const apply = process.argv.includes('--apply');
const prisma = new PrismaClient();

async function main() {
  const stickers = await prisma.sticker.findMany({
    where: { packageId: { not: null } },
    select: { id: true, userId: true, packageId: true, package: { select: { id: true, userId: true } } }
  });
  const mismatches = stickers.filter(sticker => sticker.package && sticker.userId !== sticker.package.userId);
  const packages = await prisma.package.findMany({ select: { id: true, userId: true } });

  if (apply) {
    await prisma.$transaction(async tx => {
      if (mismatches.length > 0) {
        await tx.sticker.updateMany({
          where: { id: { in: mismatches.map(sticker => sticker.id) } },
          data: { packageId: null }
        });
      }
      for (const pkg of packages) {
        const stickerCount = await tx.sticker.count({ where: { packageId: pkg.id, userId: pkg.userId } });
        await tx.package.updateMany({ where: { id: pkg.id }, data: { stickerCount } });
      }
    });
  }

  console.log(JSON.stringify({
    mode: apply ? 'apply' : 'diagnose',
    mismatches: mismatches.map(sticker => ({
      stickerId: sticker.id,
      stickerUserId: sticker.userId,
      packageId: sticker.packageId,
      packageUserId: sticker.package.userId
    })),
    repaired: apply ? mismatches.length : 0,
    packageCountsRecomputed: apply ? packages.length : 0
  }, null, 2));
}

main()
  .catch(error => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
