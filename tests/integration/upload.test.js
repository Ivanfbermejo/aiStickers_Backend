import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import sharp from 'sharp';
import fs from 'node:fs';
import path from 'node:path';
import { buildTestApp } from '../helpers/app.js';
import { signRequest } from '../helpers/hmac.js';
import jwt from 'jsonwebtoken';
import { Balance } from '../../src/domain/entities/balance.entity.js';

const CLIENT_ID = process.env.CLIENT_ID;
const CLIENT_SECRET = process.env.CLIENT_SECRET;
const JWT_SECRET = process.env.JWT_SECRET;

function makeUserToken(sub = 'user@example.com') {
  return jwt.sign({ sub, type: 'user', scope: ['stickers'] }, JWT_SECRET, { expiresIn: '1h' });
}

async function seedBalance(container, userId, amount) {
  await container.repositories.balance.save(new Balance({ userId, stickerDollars: amount }));
}

async function makePngBuffer() {
  return sharp({
    create: { width: 10, height: 10, channels: 3, background: 'red' }
  })
    .png()
    .toBuffer();
}

describe('Upload and static serving', () => {
  let ctx;
  let token;

  beforeEach(async () => {
    ctx = await buildTestApp();
    token = makeUserToken();
  });

  afterEach(() => {
    ctx.cleanup();
  });

  it('serves a file placed in the uploads directory', async () => {
    const filePath = path.join(ctx.dataDir, 'uploads', 'hello.txt');
    fs.writeFileSync(filePath, 'hello uploads');

    const res = await request(ctx.app).get('/uploads/hello.txt');

    expect(res.status).toBe(200);
    expect(res.text).toBe('hello uploads');
  });

  it('accepts an image upload through multer and creates a generation job', async () => {
    await seedBalance(ctx.container, 'user@example.com', 10);
    const imageBuffer = await makePngBuffer();
    const headers = signRequest({
      method: 'POST',
      path: '/api/v1/ai/process-image',
      clientId: CLIENT_ID,
      clientSecret: CLIENT_SECRET
    });

    const res = await request(ctx.app)
      .post('/api/v1/ai/process-image')
      .set(headers)
      .set('Authorization', `Bearer ${token}`)
      .attach('image', imageBuffer, 'test.png')
      .field('prompt', 'a sticker');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.jobId).toBeTypeOf('string');
  });

  it('rejects a non-image upload with 400', async () => {
    const headers = signRequest({
      method: 'POST',
      path: '/api/v1/ai/process-image',
      clientId: CLIENT_ID,
      clientSecret: CLIENT_SECRET
    });

    const res = await request(ctx.app)
      .post('/api/v1/ai/process-image')
      .set(headers)
      .set('Authorization', `Bearer ${token}`)
      .attach('image', Buffer.from('not an image'), 'test.txt')
      .field('prompt', 'a sticker');

    expect(res.status).toBe(400);
  });
});
