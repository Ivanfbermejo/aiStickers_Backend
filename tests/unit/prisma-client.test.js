import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

describe('Prisma client singleton (no database required)', () => {
  const originalDatabaseUrl = process.env.DATABASE_URL;

  beforeEach(() => {
    vi.resetModules();
    delete process.env.DATABASE_URL;
  });

  afterEach(() => {
    vi.resetModules();
    if (originalDatabaseUrl === undefined) {
      delete process.env.DATABASE_URL;
    } else {
      process.env.DATABASE_URL = originalDatabaseUrl;
    }
  });

  it('throws when DATABASE_URL is not configured', async () => {
    const { getPrismaClient } = await import('../../src/infrastructure/persistence/prisma/client.js');
    expect(() => getPrismaClient()).toThrow(/DATABASE_URL/);
  });

  it('disconnectPrisma is a no-op when no client was ever created', async () => {
    const { disconnectPrisma } = await import('../../src/infrastructure/persistence/prisma/client.js');
    await expect(disconnectPrisma()).resolves.toBeUndefined();
  });
});
