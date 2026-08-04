import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { randomUUID, createHash } from 'node:crypto';
import { PrismaClient } from '@prisma/client';

import { Session } from '../../../src/domain/entities/session.entity.js';
import { PostgresSessionRepository } from '../../../src/infrastructure/persistence/postgres/postgres-session.repository.js';
import { SessionService } from '../../../src/application/services/session.service.js';
import { JwtService } from '../../../src/infrastructure/auth/jwt.service.js';
import { hasTestDatabase, getBaseDatabaseUrl, migrateDeploy } from '../../helpers/postgres.js';

function sha256Hex(value) {
  return createHash('sha256').update(value).digest('hex');
}

describe.skipIf(!hasTestDatabase())('Session rotation — real PostgreSQL (T03)', () => {
  let prisma;
  let repos;
  let sessionService;
  const createdUserIds = [];

  beforeAll(async () => {
    const dbUrl = getBaseDatabaseUrl();
    await migrateDeploy(dbUrl);
    prisma = new PrismaClient({ datasources: { db: { url: dbUrl } } });
    repos = { session: new PostgresSessionRepository() };
    sessionService = new SessionService({
      sessionRepository: repos.session,
      jwtService: new JwtService()
    });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await prisma.authSession.deleteMany({});
    createdUserIds.length = 0;
  });

  async function createUser() {
    const user = await prisma.user.create({
      data: { email: `${randomUUID()}@rotation.test`, name: 'Rotation Test' }
    });
    createdUserIds.push(user.id);
    return user.id;
  }

  async function makeSession(userId, overrides = {}) {
    const token = `rt_${randomUUID()}`;
    const session = new Session({
      id: randomUUID(),
      userId,
      refreshTokenHash: sha256Hex(token),
      family: randomUUID(),
      expiresAt: overrides.expiresAt ?? new Date(Date.now() + 86400000).toISOString(),
      metadata: overrides.metadata ?? {}
    });
    await repos.session.save(session);
    return { token, session };
  }

  it('concurrent refresh: at most one rotation succeeds and no two valid descendants exist', async () => {
    const userId = await createUser();
    const { token, session: parent } = await makeSession(userId);

    const [first, second] = await Promise.allSettled([
      sessionService.rotateRefreshToken(token),
      sessionService.rotateRefreshToken(token)
    ]);

    const successes = [first, second].filter(r => r.status === 'fulfilled');
    const failures = [first, second].filter(r => r.status === 'rejected');

    expect(successes).toHaveLength(1);
    expect(failures).toHaveLength(1);
    expect(failures[0].reason.message).toBe('Refresh token reused');

    const winningRefreshToken = successes[0].value.refreshToken;

    // Reuse detection must have revoked the whole family, including the
    // descendant that briefly won the race.
    const family = await repos.session.findByFamily(parent.family);
    expect(family).toHaveLength(2);
    expect(family.every(s => s.isRevoked())).toBe(true);

    const parentAfter = await repos.session.findById(parent.id);
    const descendant = family.find(s => s.id !== parent.id);
    expect(parentAfter.rotatedTo).toBe(descendant.id);

    // Neither the parent nor the descendant can be refreshed anymore.
    await expect(sessionService.rotateRefreshToken(token)).rejects.toThrow();
    await expect(sessionService.rotateRefreshToken(winningRefreshToken)).rejects.toThrow('Refresh token revoked');
  });

  it('detects reuse and revokes every member of the family, including the descendant', async () => {
    const userId = await createUser();
    const { token: parentToken, session: parent } = await makeSession(userId);

    const rotated = await sessionService.rotateRefreshToken(parentToken);
    const familyAfterRotate = await repos.session.findByFamily(parent.family);
    expect(familyAfterRotate).toHaveLength(2);
    expect(familyAfterRotate.every(s => !s.isRevoked())).toBe(true);

    // Reusing the already-rotated parent token revokes the whole family.
    await expect(sessionService.rotateRefreshToken(parentToken)).rejects.toThrow('Refresh token reused');

    const familyAfterReuse = await repos.session.findByFamily(parent.family);
    expect(familyAfterReuse.every(s => s.isRevoked())).toBe(true);

    // The freshly issued descendant is now useless too.
    await expect(sessionService.rotateRefreshToken(rotated.refreshToken)).rejects.toThrow('Refresh token revoked');
  });

  it('successive rotations inherit the original expiresAt and never extend it', async () => {
    const userId = await createUser();
    const originalExpiresAt = new Date(Date.now() + 3600000).toISOString();
    const { token: firstToken, session: first } = await makeSession(userId, { expiresAt: originalExpiresAt });

    let currentToken = firstToken;
    for (let i = 0; i < 3; i += 1) {
      const rotated = await sessionService.rotateRefreshToken(currentToken);
      currentToken = rotated.refreshToken;
    }

    const family = await repos.session.findByFamily(first.family);
    expect(family).toHaveLength(4);

    for (const member of family) {
      expect(member.expiresAt).toBe(originalExpiresAt);
    }
  });

  it('rolls back the parent update when the descendant insert fails', async () => {
    const userId = await createUser();
    const { token: parentToken, session: parent } = await makeSession(userId);

    // Create a second, unrelated session whose hash we will try to reuse as
    // the descendant hash. The unique constraint on refreshTokenHash must make
    // the insert fail and roll back the parent update.
    const collidingHash = sha256Hex(`rt_${randomUUID()}`);
    const other = new Session({
      id: randomUUID(),
      userId,
      refreshTokenHash: collidingHash,
      family: randomUUID(),
      expiresAt: new Date(Date.now() + 86400000).toISOString()
    });
    await repos.session.save(other);

    await expect(
      repos.session.rotate(parent.refreshTokenHash, {
        id: randomUUID(),
        refreshTokenHash: collidingHash
      })
    ).rejects.toThrow();

    // Parent must remain unrotated and usable.
    const parentAfter = await repos.session.findById(parent.id);
    expect(parentAfter.rotatedTo).toBeNull();
    expect(parentAfter.isRevoked()).toBe(false);
    expect(parentAfter.isExpired()).toBe(false);
  });

  it('logout/revocation still prevents refresh', async () => {
    const userId = await createUser();
    const { token } = await makeSession(userId);

    await sessionService.revokeSession(token);

    await expect(sessionService.rotateRefreshToken(token)).rejects.toThrow('Refresh token revoked');
  });
});
