#!/usr/bin/env node
import { S3AssetStorage } from '../src/infrastructure/storage/s3-asset-storage.js';

const mode = process.argv.includes('--verify') ? 'verify' : 'seed';
const key = 'ci-persistence/probe.txt';
const storage = new S3AssetStorage({
  endpoint: process.env.MINIO_ENDPOINT || 'http://127.0.0.1:9000',
  bucket: process.env.MINIO_BUCKET || 'aistickers-private-assets',
  region: process.env.MINIO_REGION || 'us-east-1',
  accessKeyId: process.env.MINIO_ACCESS_KEY_ID || 'minioadmin',
  secretAccessKey: process.env.MINIO_SECRET_ACCESS_KEY || 'minioadmin123',
  forcePathStyle: true
});

if (mode === 'seed') {
  await storage.putObject(key, Buffer.from('minio-persists'), { ownerId: 'ci', mimeType: 'text/plain', sizeBytes: 14 });
  console.log('MinIO persistence probe seeded');
} else {
  const { buffer, metadata } = await storage.getObject(key);
  if (buffer.toString() !== 'minio-persists' || metadata.ownerId !== 'ci') throw new Error('MinIO persistence probe was lost');
  await storage.deleteObject(key);
  console.log('MinIO persistence probe verified');
}
