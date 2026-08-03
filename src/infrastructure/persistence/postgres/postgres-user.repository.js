import { User } from '../../../domain/entities/user.entity.js';
import { IUserRepository } from '../../../domain/repositories/user.repository.js';
import { getPrismaClient } from '../prisma/client.js';

function toUser(raw) {
  if (!raw) return null;
  const googleIdentity = raw.authIdentities?.find(i => i.provider === 'GOOGLE');
  return new User({
    id: raw.id,
    email: raw.email,
    name: raw.name ?? null,
    googleId: googleIdentity?.subject ?? null,
    createdAt: raw.createdAt.toISOString(),
    updatedAt: raw.updatedAt.toISOString()
  });
}

export class PostgresUserRepository extends IUserRepository {
  async findById(id) {
    const raw = await getPrismaClient().user.findUnique({
      where: { id },
      include: { authIdentities: true }
    });
    return toUser(raw);
  }

  async findByEmail(email) {
    const raw = await getPrismaClient().user.findUnique({
      where: { email },
      include: { authIdentities: true }
    });
    return toUser(raw);
  }

  async findByGoogleId(googleId) {
    const raw = await getPrismaClient().authIdentity.findUnique({
      where: { provider_subject: { provider: 'GOOGLE', subject: googleId } },
      include: { user: { include: { authIdentities: true } } }
    });
    return raw ? toUser(raw.user) : null;
  }

  async save(user) {
    const prisma = getPrismaClient();
    await prisma.user.upsert({
      where: { id: user.id },
      update: {
        email: user.email,
        name: user.name,
        updatedAt: new Date(user.updatedAt)
      },
      create: {
        id: user.id,
        email: user.email,
        name: user.name,
        createdAt: new Date(user.createdAt),
        updatedAt: new Date(user.updatedAt)
      }
    });

    if (user.googleId) {
      await prisma.authIdentity.upsert({
        where: { provider_subject: { provider: 'GOOGLE', subject: user.googleId } },
        update: { userId: user.id },
        create: {
          userId: user.id,
          provider: 'GOOGLE',
          subject: user.googleId
        }
      });
    }

    return user;
  }

  async update(user) {
    return this.save(user);
  }

  async delete(id) {
    await getPrismaClient().user.delete({ where: { id } });
    return true;
  }

  async exists(email) {
    const raw = await getPrismaClient().user.findUnique({ where: { email } });
    return raw !== null;
  }
}
