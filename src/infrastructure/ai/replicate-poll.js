import fetch from 'node-fetch';
import { env } from '../../config/env.js';

/**
 * Polls a Replicate prediction until completion or timeout
 */
export async function pollPrediction(predictionUrl, timeout = 55_000, interval = 1500) {
  const t0 = Date.now();

  while (true) {
    const res = await fetch(predictionUrl, {
      headers: { Authorization: `Token ${env.REPLICATE_API_TOKEN}` }
    });
    const pred = await res.json();

    if (!['queued', 'starting', 'processing'].includes(pred.status)) return pred;

    if (Date.now() - t0 > timeout) {
      throw new Error('Timeout Replicate (use webhook for longer operations)');
    }

    await new Promise(r => setTimeout(r, interval));
  }
}
