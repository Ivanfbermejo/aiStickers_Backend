import fs from 'fs';
import path from 'path';
import { Transaction } from '../../../domain/entities/transaction.entity.js';
import { ITransactionRepository } from '../../../domain/repositories/transaction.repository.js';

/**
 * JSON Transaction Repository Implementation
 * Uses JSON file for persistence
 */
export class JsonTransactionRepository extends ITransactionRepository {
  constructor(dataDir = '/var/www/aiStickers_Backend/data') {
    super();
    this.dbFile = path.join(dataDir, 'transactions.json');
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
      console.error('Failed to load transactions:', err);
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
    return new Transaction(data);
  }
  
  async findByUserId(userId, options = {}) {
    const { limit = 50, offset = 0 } = options;
    
    const allTransactions = Array.from(this.cache.values())
      .filter(t => t.userId === userId)
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      .slice(offset, offset + limit);
    
    return allTransactions.map(t => new Transaction(t));
  }
  
  async findByProviderTransactionId(providerTransactionId) {
    const data = Array.from(this.cache.values())
      .find(t => t.providerTransactionId === providerTransactionId);
    
    if (!data) return null;
    return new Transaction(data);
  }
  
  async save(transaction) {
    this.cache.set(transaction.id, transaction.toJSON());
    await this.saveToFile();
    return transaction;
  }
  
  async exists(providerTransactionId) {
    return Array.from(this.cache.values())
      .some(t => t.providerTransactionId === providerTransactionId);
  }
  
  async getHistory(userId, limit = 50, offset = 0) {
    return this.findByUserId(userId, { limit, offset });
  }
}
