import { describe, it, expect } from 'vitest';
import {
  exportPack,
  getPackStatus,
  reconcilePack
} from '../../src/application/services/telegram.service.js';

describe('Telegram service stub', () => {
  it('exportPack throws a disabled error', async () => {
    await expect(exportPack()).rejects.toThrow('Telegram sticker export is temporarily disabled');
  });

  it('getPackStatus throws a disabled error', async () => {
    await expect(getPackStatus()).rejects.toThrow('Telegram sticker export is temporarily disabled');
  });

  it('reconcilePack throws a disabled error', async () => {
    await expect(reconcilePack()).rejects.toThrow('Telegram sticker export is temporarily disabled');
  });
});
