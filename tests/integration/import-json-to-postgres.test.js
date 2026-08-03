import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { hasTestDatabase, getBaseDatabaseUrl, migrateDeploy } from '../helpers/postgres.js';

const execFileAsync = promisify(execFile);
const scriptPath = join(process.cwd(), 'scripts/import-json-to-postgres.js');

function now() {
  return new Date().toISOString();
}

function makeValidExport(userId, overrides = {}) {
  const packageId = `pkg_${randomUUID()}`;
  const stickerId = `sticker_${randomUUID()}`;
  const jobId = `job_${randomUUID()}`;
  const txId = `tx_${randomUUID()}`;
  const purchaseId = `purchase_${randomUUID()}`;
  const sessionId = `session_${randomUUID()}`;

  const base = {
    users: {
      [userId]: { id: userId, email: `${userId}@import.test`, name: 'Importer', createdAt: now(), updatedAt: now() }
    },
    balances: {
      [userId]: { userId, stickerDollars: 100, totalPurchased: 100, totalSpent: 0, createdAt: now(), updatedAt: now() }
    },
    transactions: {
      [txId]: { id: txId, userId, type: 'PURCHASE', amount: 100, productId: 'prod-100', provider: 'GOOGLE_PLAY', providerTransactionId: 'store-1', balanceAfter: 100, createdAt: now() }
    },
    purchases: {
      [purchaseId]: { id: purchaseId, userId, provider: 'GOOGLE_PLAY', productId: 'prod-100', purchaseToken: 'token-1', status: 'VERIFIED', stickerAmount: 100, createdAt: now(), verifiedAt: now() }
    },
    packages: {
      [packageId]: { id: packageId, userId, name: 'Imported Pack', createdAt: now(), updatedAt: now() }
    },
    stickers: {
      [stickerId]: { id: stickerId, userId, packageId, name: 'Imported Sticker', status: 'done', imageUrl: 'http://example.com/s.png', createdAt: now(), updatedAt: now() }
    },
    'generation-jobs': {
      [jobId]: { id: jobId, userId, type: 'image_sticker', status: 'queued', stickerId, createdAt: now(), updatedAt: now() }
    },
    sessions: {
      [sessionId]: { id: sessionId, userId, refreshTokenHash: `hash-${randomUUID()}`, family: `fam-${randomUUID()}`, expiresAt: now(), createdAt: now() }
    }
  };

  return { ...base, ...overrides };
}

function writeExport(dir, data) {
  for (const [file, content] of Object.entries(data)) {
    writeFileSync(join(dir, `${file}.json`), JSON.stringify(content, null, 2));
  }
}

describe.skipIf(!hasTestDatabase())('Import JSON to PostgreSQL', () => {
  let prisma;
  let sourceDir;
  const importedUserIds = [];

  beforeAll(async () => {
    await migrateDeploy(getBaseDatabaseUrl());
    prisma = new PrismaClient({ datasources: { db: { url: getBaseDatabaseUrl() } } });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  afterEach(async () => {
    if (sourceDir) {
      rmSync(sourceDir, { recursive: true, force: true });
      sourceDir = null;
    }
    for (const userId of importedUserIds.splice(0)) {
      await prisma.authSession.deleteMany({ where: { userId } });
      await prisma.authIdentity.deleteMany({ where: { userId } });
      await prisma.generationJob.deleteMany({ where: { userId } });
      await prisma.sticker.deleteMany({ where: { userId } });
      await prisma.package.deleteMany({ where: { userId } });
      await prisma.ledgerEntry.deleteMany({ where: { userId } });
      await prisma.purchase.deleteMany({ where: { userId } });
      await prisma.balance.deleteMany({ where: { userId } });
      await prisma.user.deleteMany({ where: { id: userId } });
    }
  });

  function parseReport(stdout) {
    const start = stdout.indexOf('{');
    const end = stdout.lastIndexOf('}');
    if (start === -1 || end === -1 || end < start) {
      throw new Error(`No JSON report in stdout: ${stdout}`);
    }
    return JSON.parse(stdout.slice(start, end + 1));
  }

  function runImport(args) {
    return execFileAsync(process.execPath, [scriptPath, ...args], {
      cwd: process.cwd(),
      env: { ...process.env, DATABASE_URL: getBaseDatabaseUrl() }
    });
  }

  it('dry-run validates and reports counts without writing', async () => {
    sourceDir = mkdtempSync(join(tmpdir(), 'aistickers-import-'));
    const userId = `user_${randomUUID()}`;
    const data = makeValidExport(userId);
    writeExport(sourceDir, data);

    const { stdout } = await runImport(['--source', sourceDir]);
    const report = parseReport(stdout);
    expect(report.users).toBe(1);

    const dbUser = await prisma.user.findUnique({ where: { id: userId } });
    expect(dbUser).toBeNull();
  });

  it('writes records with --commit and is idempotent', async () => {
    sourceDir = mkdtempSync(join(tmpdir(), 'aistickers-import-'));
    const userId = `user_${randomUUID()}`;
    importedUserIds.push(userId);
    const data = makeValidExport(userId);
    writeExport(sourceDir, data);

    const first = await runImport(['--source', sourceDir, '--commit']);
    const firstReport = parseReport(first.stdout);
    expect(firstReport.users).toBe(1);

    const dbUser = await prisma.user.findUnique({ where: { id: userId } });
    expect(dbUser).not.toBeNull();

    const second = await runImport(['--source', sourceDir, '--commit']);
    const secondReport = parseReport(second.stdout);
    expect(secondReport.insertedUsers).toBe(0);

    const counts = {
      users: await prisma.user.count({ where: { id: userId } }),
      balances: await prisma.balance.count({ where: { userId } }),
      ledger: await prisma.ledgerEntry.count({ where: { userId } }),
      purchases: await prisma.purchase.count({ where: { userId } }),
      packages: await prisma.package.count({ where: { userId } }),
      stickers: await prisma.sticker.count({ where: { userId } }),
      jobs: await prisma.generationJob.count({ where: { userId } }),
      sessions: await prisma.authSession.count({ where: { userId } })
    };
    expect(counts).toEqual({ users: 1, balances: 1, ledger: 1, purchases: 1, packages: 1, stickers: 1, jobs: 1, sessions: 1 });
  });

  it('aborts and rolls back on invalid references', async () => {
    sourceDir = mkdtempSync(join(tmpdir(), 'aistickers-import-'));
    const userId = `user_${randomUUID()}`;
    const data = makeValidExport(userId);
    const missingUserId = `user_${randomUUID()}`;
    data.stickers[`sticker_${randomUUID()}`] = {
      id: `sticker_${randomUUID()}`,
      userId: missingUserId,
      name: 'Orphan',
      status: 'done',
      imageUrl: 'http://example.com/x.png',
      createdAt: now(),
      updatedAt: now()
    };
    writeExport(sourceDir, data);

    await expect(runImport(['--source', sourceDir, '--commit'])).rejects.toMatchObject({ code: 1 });

    const dbUser = await prisma.user.findUnique({ where: { id: userId } });
    expect(dbUser).toBeNull();
  });

  it('aborts on corrupt JSON', async () => {
    sourceDir = mkdtempSync(join(tmpdir(), 'aistickers-import-'));
    const userId = `user_${randomUUID()}`;
    const data = makeValidExport(userId);
    writeExport(sourceDir, data);
    writeFileSync(join(sourceDir, 'users.json'), '{ not valid json');

    await expect(runImport(['--source', sourceDir, '--commit'])).rejects.toMatchObject({ code: 1 });
  });
});
