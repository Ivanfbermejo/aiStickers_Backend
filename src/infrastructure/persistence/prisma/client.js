import { PrismaClient } from '@prisma/client';
import { env } from '../../../config/env.js';

/**
 * Lazily-created Prisma Client singleton.
 *
 * This module does not connect eagerly: the JSON repositories remain the
 * source of truth until T05B cuts over to Postgres-backed repositories.
 * Call getPrismaClient() only where a real database connection is needed
 * (readiness probes, migration tooling, tests).
 */
let client = null;

export function getPrismaClient() {
  if (!client) {
    if (!env.DATABASE_URL) {
      throw new Error('DATABASE_URL is not configured; cannot create a Prisma client');
    }
    client = new PrismaClient({
      datasources: { db: { url: env.DATABASE_URL } }
    });
  }
  return client;
}

/**
 * Ping the database with a trivial query. Used by readiness probes.
 * Throws if the connection cannot be established.
 */
export async function pingDatabase() {
  const prisma = getPrismaClient();
  await prisma.$queryRaw`SELECT 1`;
}

/**
 * Return live PostgreSQL backend counts for this database user. PostgreSQL
 * exposes the state of every connection, including Prisma's pool, through
 * pg_stat_activity; no configured or guessed pool size is used.
 */
export async function getDatabaseConnectionMetrics() {
  const prisma = getPrismaClient();
  const rows = await prisma.$queryRaw`
    SELECT
      COUNT(*) FILTER (WHERE state = 'active') AS in_use,
      COUNT(*) FILTER (WHERE state = 'idle') AS idle
    FROM pg_catalog.pg_stat_activity
    WHERE datname = current_database()
      AND usename = current_user
  `;
  const row = rows[0] || {};
  return {
    inUse: Number(row.in_use || 0),
    idle: Number(row.idle || 0)
  };
}

/**
 * Disconnect the singleton client, if it was ever created. Safe to call
 * multiple times and safe to call even if no client was created.
 */
export async function disconnectPrisma() {
  if (client) {
    await client.$disconnect();
    client = null;
  }
}
