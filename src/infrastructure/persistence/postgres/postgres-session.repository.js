import { Session } from '../../../domain/entities/session.entity.js';
import { ISessionRepository } from '../../../domain/repositories/session.repository.js';
import { getPrismaClient } from '../prisma/client.js';

function toSession(raw) {
  if (!raw) return null;
  return new Session({
    id: raw.id,
    userId: raw.userId,
    refreshTokenHash: raw.refreshTokenHash,
    family: raw.family,
    createdAt: raw.createdAt.toISOString(),
    expiresAt: raw.expiresAt.toISOString(),
    rotatedTo: raw.rotatedTo ?? null,
    revokedAt: raw.revokedAt?.toISOString() ?? null,
    metadata: raw.metadata ?? {}
  });
}

function toSessionData(session) {
  return {
    id: session.id,
    userId: session.userId,
    refreshTokenHash: session.refreshTokenHash,
    family: session.family,
    createdAt: new Date(session.createdAt),
    expiresAt: new Date(session.expiresAt),
    rotatedTo: session.rotatedTo || null,
    revokedAt: session.revokedAt ? new Date(session.revokedAt) : null,
    metadata: session.metadata || {}
  };
}

export class PostgresSessionRepository extends ISessionRepository {
  async findById(id) {
    const raw = await getPrismaClient().authSession.findUnique({ where: { id } });
    return toSession(raw);
  }

  async findByRefreshTokenHash(hash) {
    const raw = await getPrismaClient().authSession.findUnique({ where: { refreshTokenHash: hash } });
    return toSession(raw);
  }

  async findByFamily(family) {
    const rows = await getPrismaClient().authSession.findMany({ where: { family } });
    return rows.map(toSession);
  }

  async save(session) {
    const prisma = getPrismaClient();
    const data = toSessionData(session);
    await prisma.authSession.upsert({
      where: { id: session.id },
      update: {
        userId: data.userId,
        refreshTokenHash: data.refreshTokenHash,
        family: data.family,
        expiresAt: data.expiresAt,
        rotatedTo: data.rotatedTo,
        revokedAt: data.revokedAt,
        metadata: data.metadata
      },
      create: data
    });
    return session;
  }

  async update(session) {
    return this.save(session);
  }

  async revokeFamily(family) {
    await getPrismaClient().authSession.updateMany({
      where: { family, revokedAt: null },
      data: { revokedAt: new Date() }
    });
  }
}
