import { describe, it, expect } from 'vitest';
import { GenerationJob } from '../../src/domain/entities/generation-job.entity.js';
import { Sticker } from '../../src/domain/entities/sticker.entity.js';
import { GenerationJobWorker } from '../../src/infrastructure/ai/generation-job.worker.js';

describe('Generation result storage', () => {
  it('copies and verifies the external result before completing the job', async () => {
    const events = [];
    const job = new GenerationJob({
      id: 'job-1',
      userId: 'user-a',
      type: 'image_sticker',
      stickerId: 'sticker-1',
      input: { objectKey: 'input.png' }
    });
    const sticker = new Sticker({
      id: 'sticker-1',
      userId: 'user-a',
      status: 'processing'
    });
    const generationJobRepository = {
      update: async current => {
        if (current.status === 'completed') events.push('job:completed');
      }
    };
    const stickerRepository = {
      findById: async () => sticker,
      update: async () => events.push('sticker:stored')
    };
    const assetService = {
      getSignedUrl: async () => 'https://private.example/input?signature=short',
      copyExternalToStorage: async options => {
        events.push('asset:copied');
        expect(options.idempotencyKey).toBe('generation-result:job-1');
        return {
          key: 'result.png',
          hash: 'a'.repeat(64),
          sizeBytes: 128,
          mimeType: 'image/png',
          width: 32,
          height: 32
        };
      }
    };
    const worker = new GenerationJobWorker({
      generationJobRepository,
      stickerRepository,
      imageProvider: {
        generate: async input => {
          expect(input.imageUrl).toContain('signature=short');
          return {
            imageUrl: 'https://replicate.delivery/result.png',
            providerPredictionId: 'prediction-1'
          };
        }
      },
      animationProvider: { animate: async () => null },
      assetService,
      refundBalanceUseCase: { execute: async () => {} }
    });

    await worker.processJob(job);

    expect(events.indexOf('asset:copied')).toBeLessThan(events.indexOf('job:completed'));
    expect(events.indexOf('sticker:stored')).toBeLessThan(events.indexOf('job:completed'));
    expect(job.result).toEqual(expect.objectContaining({ objectKey: 'result.png' }));
    expect(job.result.imageUrl).toBeUndefined();
    expect(sticker.imageUrl).toBeNull();
  });
});
