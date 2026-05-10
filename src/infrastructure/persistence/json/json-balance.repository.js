import fs from 'fs';
import path from 'path';
import { Balance } from '../../../domain/entities/balance.entity.js';
import { IBalanceRepository } from '../../../domain/repositories/balance.repository.js';

/**
 * JSON Balance Repository Implementation
 * Uses JSON file for persistence
 */
export class JsonBalanceRepository extends IBalanceRepository {
  constructor(dataDir = '/var/www/aiStickers_Backend/data') {
    super();
    this.dbFile = path.join(dataDir, 'balances.json');
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
      console.error('Failed to load balances:', err);
      this.cache = new Map();
    }
  }
  
  async saveToFile() {
    const data = Object.fromEntries(this.cache);
    await fs.promises.writeFile(this.dbFile, JSON.stringify(data, null, 2));
  }
  
  async findByUserId(userId) {
    const data = this.cache.get(userId);
    if (!data) return null;
    return new Balance(data);
  }
  
  async save(balance) {
    this.cache.set(balance.userId, balance.toJSON());
    await this.saveToFile();
    return balance;
  }
  
  async update(balance) {
    return this.save(balance);
  }
  
  async createForUser(userId) {
    const balance = new Balance({ userId, stickerDollars: 0 });
    await this.save(balance);
    return balance;
  }
  
  async exists(userId) {
    return this.cache.has(userId);
  }
}
