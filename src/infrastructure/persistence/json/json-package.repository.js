import fs from 'fs';
import path from 'path';
import { Package } from '../../../domain/entities/package.entity.js';
import { IPackageRepository } from '../../../domain/repositories/package.repository.js';
import { getLogger } from '../../observability/logger.js';

/**
 * JSON Package Repository Implementation
 * Uses JSON file for persistence
 */
export class JsonPackageRepository extends IPackageRepository {
  constructor(dataDir = '/var/www/aiStickers_Backend/data') {
    super();
    this.dbFile = path.join(dataDir, 'packages.json');
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
      getLogger().error({ err }, 'Failed to load packages:');
      this.cache = new Map();
    }
  }
  
  async saveToFile() {
    const data = Object.fromEntries(this.cache);
    await fs.promises.writeFile(this.dbFile, JSON.stringify(data, null, 2));
  }
  
  async findById(id, userId) {
    const data = this.cache.get(id);
    if (!data || (userId && data.userId !== userId)) return null;
    return new Package(data);
  }

  async findPublicById(id) {
    const data = this.cache.get(id);
    if (!data || data.isPublic !== true) return null;
    return new Package(data);
  }
  
  async findByUserId(userId) {
    const packages = Array.from(this.cache.values())
      .filter(p => p.userId === userId)
      .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
    return packages.map(p => new Package(p));
  }
  
  async findPublic() {
    const packages = Array.from(this.cache.values())
      .filter(p => p.isPublic === true)
      .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
    return packages.map(p => new Package(p));
  }
  
  async findByCategory(category) {
    const packages = Array.from(this.cache.values())
      .filter(p => p.category === category && p.isPublic === true)
      .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
    return packages.map(p => new Package(p));
  }
  
  async findByTag(tag) {
    const packages = Array.from(this.cache.values())
      .filter(p => p.tags && p.tags.includes(tag) && p.isPublic === true)
      .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
    return packages.map(p => new Package(p));
  }
  
  async save(pkg) {
    this.cache.set(pkg.id, {
      id: pkg.id,
      userId: pkg.userId,
      name: pkg.name,
      author: pkg.author,
      icon: pkg.icon,
      description: pkg.description,
      isPublic: pkg.isPublic,
      stickerCount: pkg.stickerCount,
      category: pkg.category,
      tags: pkg.tags,
      platform: pkg.platform,
      packType: pkg.packType,
      trayIconUrl: pkg.trayIconUrl,
      trayIconObjectKey: pkg.trayIconObjectKey,
      trayIconObjectHash: pkg.trayIconObjectHash,
      trayIconObjectSize: pkg.trayIconObjectSize,
      trayIconObjectMime: pkg.trayIconObjectMime,
      trayIconObjectWidth: pkg.trayIconObjectWidth,
      trayIconObjectHeight: pkg.trayIconObjectHeight,
      exportStatus: pkg.exportStatus,
      whatsappReady: pkg.whatsappReady,
      exportError: pkg.exportError,
      createdAt: pkg.createdAt,
      updatedAt: pkg.updatedAt
    });
    await this.saveToFile();
    return pkg;
  }
  
  async update(pkg, userId = pkg?.userId) {
    const current = this.cache.get(pkg.id);
    if (!current || (userId && current.userId !== userId)) return false;
    return this.save(pkg);
  }
  
  async delete(id, userId) {
    const current = this.cache.get(id);
    if (!current || (userId && current.userId !== userId)) return false;
    this.cache.delete(id);
    await this.saveToFile();
    return true;
  }
  
  async deleteByUserId(userId) {
    const toDelete = Array.from(this.cache.entries())
      .filter(([_, p]) => p.userId === userId);
    for (const [id, _] of toDelete) {
      this.cache.delete(id);
    }
    await this.saveToFile();
    return toDelete.length;
  }
  
  async countByUserId(userId) {
    return Array.from(this.cache.values()).filter(p => p.userId === userId).length;
  }
  
  async exists(id) {
    return this.cache.has(id);
  }
}
