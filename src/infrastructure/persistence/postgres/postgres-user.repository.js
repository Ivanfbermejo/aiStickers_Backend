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
  constructor(prismaClient) {
    super();
    this.prisma = prismaClient;
  }

  _getPrisma(tx) {
    return tx || this.prisma || getPrismaClient();
  }

  withPrisma(prismaClient) {
    return new PostgresUserRepository(prismaClient);
  }

  async findById(id, tx) {
    const raw = await this._getPrisma(tx).user.findUnique({
      where: { id },
      include: { authIdentities: true }
    });
    return toUser(raw);
  }

  async findByEmail(email, tx) {
    const raw = await this._getPrisma(tx).user.findUnique({
      where: { email },
      include: { authIdentities: true }
    });
    return toUser(raw);
  }

  async findByGoogleId(googleId, tx) {
    const raw = await this._getPrisma(tx).authIdentity.findUnique({
      where: { provider_subject: { provider: 'GOOGLE', subject: googleId } },
      include: { user: { include: { authIdentities: true } } }
    });
    return raw ? toUser(raw.user) : null;
  }

  async save(user, tx) {
    const prisma = this._getPrisma(tx);
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

  async update(user, tx) {
    return this.save(user, tx);
  }

  async delete(id, tx) {
    await this._getPrisma(tx).user.delete({ where: { id } });
    return true;
  }

  async exists(email, tx) {
    const raw = await this._getPrisma(tx).user.findUnique({ where: { email } });
    return raw !== null;
  }
}
