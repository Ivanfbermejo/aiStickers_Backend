import { describe, it, expect, beforeEach, vi } from 'vitest';
import fetch from 'node-fetch';
import { metrics } from '../../src/infrastructure/observability/metrics.js';
import { ReplicateImageProvider } from '../../src/infrastructure/ai/replicate-image.provider.js';
import { GenerationJob } from '../../src/domain/entities/generation-job.entity.js';
import { Sticker } from '../../src/domain/entities/sticker.entity.js';
import { GenerationJobWorker } from '../../src/infrastructure/ai/generation-job.worker.js';

vi.mock('node-fetch', () => ({ default: vi.fn() }));

function response(body, ok = true, status = 200) {
  return { ok, status, json: async () => body };
}

async function metricValue(name, labels = {}) {
  const metric = metrics.register.getSingleMetric(name);
  const snapshot = await metric.get();
  const sample = snapshot.values.find((value) => Object.entries(labels).every(([key, expected]) => value.labels[key] === expected));
  return Number(sample?.value || 0);
}

describe('Replicate observability', () => {
  beforeEach(() => {
    metrics.reset();
    fetch.mockReset();
  });

  it('counts one AI call only for the real provider submission', async () => {
    fetch.mockResolvedValue(response({ id: 'prediction-1' }));
    const provider = new ReplicateImageProvider();

    await provider.createPrediction({ imageUrl: 'https://private.example/input.png', prompt: 'sticker' });

    expect(fetch).toHaveBeenCalledOnce();
    expect(await metricValue('ai_calls_total', { provider: 'replicate', type: 'image_sticker' })).toBe(1);
  });

  it('does not count polling requests as AI calls or costs', async () => {
    fetch
      .mockResolvedValueOnce(response({ status: 'queued' }))
      .mockResolvedValueOnce(response({ status: 'processing' }))
      .mockResolvedValueOnce(response({ status: 'succeeded', output: 'https://replicate.example/result.png', metrics: { total_cost: 0.12 } }));
    const provider = new ReplicateImageProvider();

    const result = await provider.pollPrediction('prediction-1', { timeoutMs: 1000, intervalMs: 0 });

    expect(fetch).toHaveBeenCalledTimes(3);
    expect(result.costUsd).toBe(0.12);
    expect(await metricValue('ai_calls_total', { provider: 'replicate', type: 'image_sticker' })).toBe(0);
    expect(await metricValue('ai_cost_usd_total', { provider: 'replicate', type: 'image_sticker' })).toBe(0);
  });

  it('counts an HTTP provider error once instead of once in provider and controller', async () => {
    fetch.mockResolvedValue(response({}, false, 503));
    const provider = new ReplicateImageProvider();

    await expect(provider.createPrediction({ imageUrl: 'https://private.example/input.png' })).rejects.toMatchObject({ code: 'PROVIDER_HTTP_503' });

    expect(await metricValue('ai_errors_total', {
      provider: 'replicate',
      type: 'image_sticker',
      category: 'http'
    })).toBe(1);
  });

  it('records provider cost once after a generation is completed', async () => {
    const job = new GenerationJob({
      id: 'job-metrics-1',
      userId: 'user-1',
      type: 'image_sticker',
      stickerId: 'sticker-metrics-1',
      input: {}
    });
    const sticker = new Sticker({ id: 'sticker-metrics-1', userId: 'user-1', status: 'processing' });
    const worker = new GenerationJobWorker({
      generationJobRepository: { update: async () => {} },
      stickerRepository: { findById: async () => sticker, update: async () => {} },
      imageProvider: {
        createPrediction: async () => ({ providerPredictionId: 'prediction-1' }),
        pollPrediction: async () => ({ imageUrl: 'https://replicate.example/result.png', costUsd: 0.12 })
      },
      animationProvider: {},
      assetService: {
        copyExternalToStorage: async () => ({
          key: 'result.png',
          hash: 'a'.repeat(64),
          sizeBytes: 10,
          mimeType: 'image/png',
          width: 10,
          height: 10
        })
      },
      refundBalanceUseCase: { execute: async () => {} }
    });

    await worker.processJob(job);
    await worker.processJob(job);

    expect(await metricValue('ai_cost_usd_total', { provider: 'replicate', type: 'image_sticker' })).toBe(0.12);
  });
});
