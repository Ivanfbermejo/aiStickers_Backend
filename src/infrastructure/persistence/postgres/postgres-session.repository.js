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

  async rotate(refreshTokenHash, candidate) {
    const prisma = getPrismaClient();

    // Atomic rotation: claim the parent and insert the descendant in a single
    // transaction. If the claim fails (rotatedTo is no longer null, revoked or
    // expired) the transaction returns null without side effects.
    let created;
    try {
      created = await prisma.$transaction(async (tx) => {
        const claimed = await tx.$queryRaw`
          UPDATE "auth_sessions"
          SET "rotatedTo" = ${candidate.id}
          WHERE "refreshTokenHash" = ${refreshTokenHash}
            AND "rotatedTo" IS NULL
            AND "revokedAt" IS NULL
            AND "expiresAt" > now()
          RETURNING id, "userId", family, "expiresAt", metadata
        `;

        if (claimed.length === 0) {
          return null;
        }

        const parent = claimed[0];
        const metadata = candidate.metadata || parent.metadata || {};
        return tx.authSession.create({
          data: {
            id: candidate.id,
            userId: parent.userId,
            refreshTokenHash: candidate.refreshTokenHash,
            family: parent.family,
            expiresAt: parent.expiresAt,
            metadata
          }
        });
      });
    } catch (error) {
      // Unexpected transaction failure (e.g. unique constraint on the new hash).
      // The parent claim is rolled back automatically.
      throw error;
    }

    if (created) {
      return toSession(created);
    }

    // Claim failed outside of a throwing transaction. Inspect the current row
    // to return the correct error. Family revocation on reuse is performed
    // outside the failed transaction so it is persisted.
    const parent = await prisma.authSession.findUnique({ where: { refreshTokenHash } });
    if (!parent) {
      throw new Error('Invalid refresh token');
    }
    if (parent.revokedAt) {
      throw new Error('Refresh token revoked');
    }
    if (parent.expiresAt <= new Date()) {
      throw new Error('Refresh token expired');
    }
    if (parent.rotatedTo) {
      await this.revokeFamily(parent.family);
      throw new Error('Refresh token reused');
    }
    throw new Error('Invalid refresh token');
  }
}
