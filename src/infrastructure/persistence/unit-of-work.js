import { getPrismaClient } from './prisma/client.js';
import { env } from '../../config/env.js';

/**
 * Unit-of-work abstraction.
 *
 * Financial mutations always run inside a single PostgreSQL transaction. The
 * JSON driver cannot provide transaction safety, so its unit of work fails
 * closed for writes. Tests can inject a no-op fake that runs operations
 * sequentially.
 */
export class UnitOfWork {
  async run(_callback) {
    throw new Error('UnitOfWork implementation required');
  }
}

export class PostgresUnitOfWork extends UnitOfWork {
  constructor(repositories) {
    super();
    this.prisma = getPrismaClient();
    this.repositories = repositories;
  }

  async run(callback) {
    return this.prisma.$transaction(async (tx) => {
      const transactional = {};
      for (const [key, repo] of Object.entries(this.repositories)) {
        transactional[key] =
          typeof repo.withPrisma === 'function' ? repo.withPrisma(tx) : repo;
      }
      return callback(transactional);
    });
  }
}

export class JsonUnitOfWork extends UnitOfWork {
  constructor(repositories) {
    super();
    this.repositories = repositories;
  }

  async run(callback) {
    if (env.NODE_ENV === 'production') {
      throw new Error(
        'Financial writes are disabled with the JSON driver because it cannot guarantee atomicity'
      );
    }
    // The JSON driver is intentionally not used in production (factory throws).
    // In development/test we run operations sequentially so the application
    // remains usable, but there is no real rollback if a later step fails.
    console.warn(
      '[JsonUnitOfWork] Financial operation running without transaction safety. Use PostgreSQL in production.'
    );
    return callback(this.repositories);
  }
}

export class InMemoryUnitOfWork extends UnitOfWork {
  constructor(repositories) {
    super();
    this.repositories = repositories;
  }

  async run(callback) {
    return callback(this.repositories);
  }
}
