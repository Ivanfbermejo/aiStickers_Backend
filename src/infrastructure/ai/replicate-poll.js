import fetch from 'node-fetch';
import { env } from '../../config/env.js';
import { ProviderError, providerHttpError } from './provider-error.js';

/**
 * Polls a Replicate prediction until completion or timeout
 */
export async function pollPrediction(predictionUrl, timeout = 55_000, interval = 1500) {
  const t0 = Date.now();

  while (true) {
    let res;
    try {
      res = await fetch(predictionUrl, {
        headers: { Authorization: `Token ${env.REPLICATE_API_TOKEN}` }
      });
    } catch {
      throw new ProviderError('Provider polling request failed', { code: 'PROVIDER_NETWORK' });
    }
    if (!res.ok) throw providerHttpError(res.status);

    let pred;
    try {
      pred = await res.json();
    } catch {
      throw new ProviderError('Provider returned invalid polling data', { code: 'PROVIDER_INVALID_RESPONSE' });
    }

    if (!['queued', 'starting', 'processing'].includes(pred.status)) return pred;

    if (Date.now() - t0 > timeout) {
      throw new ProviderError('Provider polling timed out', { code: 'PROVIDER_TIMEOUT' });
    }

    await new Promise(r => setTimeout(r, interval));
  }
}
