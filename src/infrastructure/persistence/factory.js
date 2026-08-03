import { env } from '../../config/env.js';

/**
 * Create repository instances for the configured PERSISTENCE_DRIVER.
 *
 * In production only the PostgreSQL driver is allowed; importing or
 * instantiating any JSON-backed repository is rejected.
 */
export async function createRepositories() {
  const driver = env.PERSISTENCE_DRIVER || 'json';

  if (env.NODE_ENV === 'production' && driver !== 'postgres') {
    throw new Error("PERSISTENCE_DRIVER must be 'postgres' in production");
  }

  if (driver === 'postgres') {
    const { PostgresUserRepository } = await import('./postgres/postgres-user.repository.js');
    const { PostgresBalanceRepository } = await import('./postgres/postgres-balance.repository.js');
    const { PostgresTransactionRepository } = await import('./postgres/postgres-transaction.repository.js');
    const { PostgresPurchaseRepository } = await import('./postgres/postgres-purchase.repository.js');
    const { PostgresStickerRepository } = await import('./postgres/postgres-sticker.repository.js');
    const { PostgresPackageRepository } = await import('./postgres/postgres-package.repository.js');
    const { PostgresGenerationJobRepository } = await import('./postgres/postgres-generation-job.repository.js');
    const { PostgresSessionRepository } = await import('./postgres/postgres-session.repository.js');

    return {
      user: new PostgresUserRepository(),
      balance: new PostgresBalanceRepository(),
      transaction: new PostgresTransactionRepository(),
      purchase: new PostgresPurchaseRepository(),
      sticker: new PostgresStickerRepository(),
      package: new PostgresPackageRepository(),
      generationJob: new PostgresGenerationJobRepository(),
      session: new PostgresSessionRepository()
    };
  }

  // JSON remains available for development and rollback windows only.
  const { JsonUserRepository } = await import('./json/json-user.repository.js');
  const { JsonBalanceRepository } = await import('./json/json-balance.repository.js');
  const { JsonTransactionRepository } = await import('./json/json-transaction.repository.js');
  const { JsonPurchaseRepository } = await import('./json/json-purchase.repository.js');
  const { JsonStickerRepository } = await import('./json/json-sticker.repository.js');
  const { JsonPackageRepository } = await import('./json/json-package.repository.js');
  const { JsonGenerationJobRepository } = await import('./json/json-generation-job.repository.js');
  const { JsonSessionRepository } = await import('./json/json-session.repository.js');

  return {
    user: new JsonUserRepository(env.DATA_DIR),
    balance: new JsonBalanceRepository(env.DATA_DIR),
    transaction: new JsonTransactionRepository(env.DATA_DIR),
    purchase: new JsonPurchaseRepository(env.DATA_DIR),
    sticker: new JsonStickerRepository(env.DATA_DIR),
    package: new JsonPackageRepository(env.DATA_DIR),
    generationJob: new JsonGenerationJobRepository(env.DATA_DIR),
    session: new JsonSessionRepository(env.DATA_DIR)
  };
}
