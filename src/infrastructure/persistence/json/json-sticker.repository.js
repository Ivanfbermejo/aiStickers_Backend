import fs from 'fs';
import path from 'path';
import { Sticker } from '../../../domain/entities/sticker.entity.js';
import { IStickerRepository } from '../../../domain/repositories/sticker.repository.js';

/**
 * JSON Sticker Repository Implementation
 * Uses JSON file for persistence
 */
export class JsonStickerRepository extends IStickerRepository {
  constructor(dataDir = '/var/www/aiStickers_Backend/data') {
    super();
    this.dbFile = path.join(dataDir, 'stickers.json');
    this.cache = new Map();
    this.ensureFileExists();
    this.loadFromFile();
  }
  
  ensureFileExists() {
    if (!fs.existsSync(this.dbFile)) {
      fs.mkdirSync(path.dirname(this.dbFile), { recursive: true });
      fs.writeFileSync(this.dbFile, JSON.stringify({}));
    }
  }
  
  loadFromFile() {
    try {
      const data = fs.readFileSync(this.dbFile, 'utf8');
      const parsed = JSON.parse(data);
      this.cache = new Map(Object.entries(parsed));
    } catch (err) {
      console.error('Failed to load stickers:', err);
      this.cache = new Map();
    }
  }
  
  async saveToFile() {
    const data = Object.fromEntries(this.cache);
    await fs.promises.writeFile(this.dbFile, JSON.stringify(data, null, 2));
  }
  
  async findById(id) {
    const data = this.cache.get(id);
    if (!data) return null;
    return new Sticker(data);
  }
  
  async findByUserId(userId) {
    const stickers = Array.from(this.cache.values())
      .filter(s => s.userId === userId)
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    return stickers.map(s => new Sticker(s));
  }
  
  async findByPackageId(packageId) {
    const stickers = Array.from(this.cache.values())
      .filter(s => s.packageId === packageId)
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    return stickers.map(s => new Sticker(s));
  }
  
  async findByReplicateId(replicateId) {
    const data = Array.from(this.cache.values()).find(s => s.replicateId === replicateId);
    if (!data) return null;
    return new Sticker(data);
  }
  
  async findByUserIdAndStatus(userId, status) {
    const stickers = Array.from(this.cache.values())
      .filter(s => s.userId === userId && s.status === status)
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    return stickers.map(s => new Sticker(s));
  }
  
  async save(sticker) {
    this.cache.set(sticker.id, {
      id: sticker.id,
      userId: sticker.userId,
      packageId: sticker.packageId,
      name: sticker.name,
      imageUrl: sticker.imageUrl,
      thumbnailUrl: sticker.thumbnailUrl,
      replicateId: sticker.replicateId,
      status: sticker.status,
      prompt: sticker.prompt,
      cost: sticker.cost,
      errorMessage: sticker.errorMessage,
      createdAt: sticker.createdAt,
      updatedAt: sticker.updatedAt
    });
    await this.saveToFile();
    return sticker;
  }
  
  async update(sticker) {
    return this.save(sticker);
  }
  
  async delete(id) {
    this.cache.delete(id);
    await this.saveToFile();
    return true;
  }
  
  async deleteByUserId(userId) {
    const toDelete = Array.from(this.cache.entries())
      .filter(([_, s]) => s.userId === userId);
    for (const [id, _] of toDelete) {
      this.cache.delete(id);
    }
    await this.saveToFile();
    return toDelete.length;
  }
  
  async countByUserId(userId) {
    return Array.from(this.cache.values()).filter(s => s.userId === userId).length;
  }
  
  async countByPackageId(packageId) {
    return Array.from(this.cache.values()).filter(s => s.packageId === packageId).length;
  }
}
