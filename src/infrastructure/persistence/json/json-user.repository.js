import fs from 'fs';
import path from 'path';
import { User } from '../../../domain/entities/user.entity.js';
import { IUserRepository } from '../../../domain/repositories/user.repository.js';

/**
 * JSON User Repository Implementation
 * Uses JSON file for persistence
 */
export class JsonUserRepository extends IUserRepository {
  constructor(dataDir = '/var/www/aiStickers_Backend/data') {
    super();
    this.dbFile = path.join(dataDir, 'users.json');
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
      console.error('Failed to load users:', err);
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
    return new User(data);
  }
  
  async findByEmail(email) {
    const data = Array.from(this.cache.values()).find(u => u.email === email);
    if (!data) return null;
    return new User(data);
  }
  
  async findByGoogleId(googleId) {
    const data = Array.from(this.cache.values()).find(u => u.googleId === googleId);
    if (!data) return null;
    return new User(data);
  }
  
  async save(user) {
    this.cache.set(user.id, {
      id: user.id,
      email: user.email,
      name: user.name,
      googleId: user.googleId,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt
    });
    await this.saveToFile();
    return user;
  }
  
  async update(user) {
    return this.save(user);
  }
  
  async delete(id) {
    this.cache.delete(id);
    await this.saveToFile();
    return true;
  }
  
  async exists(email) {
    return Array.from(this.cache.values()).some(u => u.email === email);
  }
}
