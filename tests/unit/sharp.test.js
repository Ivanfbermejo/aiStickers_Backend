import { describe, it, expect } from 'vitest';
import sharp from 'sharp';

describe('Sharp dependency', () => {
  it('loads and processes a simple image', async () => {
    const buffer = await sharp({
      create: { width: 32, height: 32, channels: 3, background: 'blue' }
    })
      .png()
      .toBuffer();

    const metadata = await sharp(buffer).metadata();
    expect(metadata.format).toBe('png');
    expect(metadata.width).toBe(32);
    expect(metadata.height).toBe(32);
  });
});
