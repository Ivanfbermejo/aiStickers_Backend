import fs from 'fs';
import path from 'path';
import { Purchase } from '../../../domain/entities/purchase.entity.js';
import { IPurchaseRepository } from '../../../domain/repositories/purchase.repository.js';

/**
 * JSON Purchase Repository Implementation
 */
export class JsonPurchaseRepository extends IPurchaseRepository {
  constructor(dataDir = '/var/www/aiStickers_Backend/data') {
    super();
    this.dbFile = path.join(dataDir, 'purchases.json');
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
      console.error('Failed to load purchases:', err);
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
    return new Purchase(data);
  }
  
  async findByToken(purchaseToken) {
    const data = Array.from(this.cache.values())
      .find(p => p.purchaseToken === purchaseToken);
    if (!data) return null;
    return new Purchase(data);
  }
  
  async findByUserId(userId, status) {
    let purchases = Array.from(this.cache.values())
      .filter(p => p.userId === userId);
    
    if (status) {
      purchases = purchases.filter(p => p.status === status);
    }
    
    return purchases.map(p => new Purchase(p));
  }
  
  async save(purchase) {
    this.cache.set(purchase.id, purchase.toJSON());
    await this.saveToFile();
    return purchase;
  }
  
  async update(purchase) {
    return this.save(purchase);
  }
  
  async exists(purchaseToken) {
    return Array.from(this.cache.values())
      .some(p => p.purchaseToken === purchaseToken);
  }
}
