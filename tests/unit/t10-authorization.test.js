import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { Sticker } from '../../src/domain/entities/sticker.entity.js';
import { Package } from '../../src/domain/entities/package.entity.js';
import { GenerationJob } from '../../src/domain/entities/generation-job.entity.js';
import { TelegramPackLink } from '../../src/domain/entities/telegram-pack-link.entity.js';
import { JsonStickerRepository } from '../../src/infrastructure/persistence/json/json-sticker.repository.js';
import { JsonPackageRepository } from '../../src/infrastructure/persistence/json/json-package.repository.js';
import { JsonGenerationJobRepository } from '../../src/infrastructure/persistence/json/json-generation-job.repository.js';
import { JsonTelegramPackLinkRepository } from '../../src/infrastructure/persistence/json/json-telegram-pack-link.repository.js';
import { CreateGenerationJobUseCase } from '../../src/application/use-cases/generation/create-generation-job.use-case.js';
import { AiController } from '../../src/infrastructure/web/controllers/ai.controller.js';

let dataDir;

afterEach(() => {
  if (dataDir) rmSync(dataDir, { recursive: true, force: true });
  dataDir = undefined;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('T10 ownership enforcement', () => {
  it('scopes private sticker, package, job and Telegram-link reads and writes', async () => {
    dataDir = mkdtempSync(join(tmpdir(), 'aistickers-t10-'));
    const stickers = new JsonStickerRepository(dataDir);
    const packages = new JsonPackageRepository(dataDir);
    const jobs = new JsonGenerationJobRepository(dataDir);
    const links = new JsonTelegramPackLinkRepository(dataDir);

    const pkg = Package.create({ userId: 'user-a', name: 'A pack' });
    const sticker = Sticker.createFromGeneration({ userId: 'user-a', packageId: pkg.id, name: 'A sticker' });
    const job = GenerationJob.create({
      userId: 'user-a',
      packageId: pkg.id,
      stickerId: sticker.id,
      type: 'image_sticker',
      input: {},
      provider: 'replicate'
    });
    const link = TelegramPackLink.create({
      userId: 'user-a',
      telegramUserId: '100',
      packageId: pkg.id,
      setName: 'aistickers_pack_by_bot'
    });

    await packages.save(pkg);
    await stickers.save(sticker);
    await jobs.save(job);
    await links.save(link);

    expect(await packages.findById(pkg.id, 'user-b')).toBeNull();
    expect(await stickers.findById(sticker.id, 'user-b')).toBeNull();
    expect(await stickers.findByPackageId(pkg.id, 'user-b')).toHaveLength(0);
    expect(await jobs.findById(job.id, 'user-b')).toBeNull();
    expect(await jobs.findByProviderPredictionId('missing', 'user-b')).toBeNull();
    expect(await links.findByUserIdAndPackageId('user-b', pkg.id)).toBeNull();
    expect(await stickers.delete(sticker.id, 'user-b')).toBe(false);
    expect(await packages.delete(pkg.id, 'user-b')).toBe(false);
  });

  it('rejects an owner-mismatched generation package before charging', async () => {
    const spend = { execute: vi.fn(), executeInTransaction: vi.fn() };
    const useCase = new CreateGenerationJobUseCase({
      packageRepository: { findById: vi.fn().mockResolvedValue(null) },
      generationJobRepository: { save: vi.fn() },
      stickerRepository: { save: vi.fn() },
      spendBalanceUseCase: spend,
      generationQueue: null,
      unitOfWork: null
    });

    await expect(useCase.execute({
      userId: 'user-b',
      type: 'image_sticker',
      packageId: 'package-a',
      asset: { key: 'user-b/input.png' }
    })).rejects.toMatchObject({ code: 'PACKAGE_NOT_FOUND' });
    expect(spend.execute).not.toHaveBeenCalled();
    expect(spend.executeInTransaction).not.toHaveBeenCalled();
  });

  it('resolves prediction ownership before making an external status request', async () => {
    vi.stubGlobal('fetch', vi.fn());
    const dependencies = {
      repositories: {
        generationJob: {
          findByProviderPredictionId: vi.fn().mockResolvedValue(null)
        }
      }
    };
    const notFound = { status: vi.fn().mockReturnThis(), json: vi.fn() };
    await AiController.getStatus({
      params: { predictionId: 'prediction-a' },
      user: { sub: 'user-b' },
      app: { locals: { container: dependencies } }
    }, notFound);
    expect(notFound.status).toHaveBeenCalledWith(404);
    expect(globalThis.fetch).not.toHaveBeenCalled();

    expect(dependencies.repositories.generationJob.findByProviderPredictionId)
      .toHaveBeenCalledWith('prediction-a', 'user-b');
  });
});
