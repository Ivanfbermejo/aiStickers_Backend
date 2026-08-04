import fs from 'node:fs';
import path from 'node:path';
import { Session } from '../../../domain/entities/session.entity.js';
import { ISessionRepository } from '../../../domain/repositories/session.repository.js';

/**
 * JSON Session Repository Implementation
 * Stores session records keyed by session id with a refresh token hash index.
 */
export class JsonSessionRepository extends ISessionRepository {
  constructor(dataDir = '/var/www/aiStickers_Backend/data') {
    super();
    this.dbFile = path.join(dataDir, 'sessions.json');
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
      console.error('Failed to load sessions:', err);
      this.cache = new Map();
    }
  }

  async saveToFile() {
    const data = Object.fromEntries(this.cache);
    await fs.promises.writeFile(this.dbFile, JSON.stringify(data, null, 2));
  }

  _toSession(raw) {
    return new Session(raw);
  }

  async findById(id) {
    const raw = this.cache.get(id);
    return raw ? this._toSession(raw) : null;
  }

  async findByRefreshTokenHash(hash) {
    const raw = Array.from(this.cache.values()).find(s => s.refreshTokenHash === hash);
    return raw ? this._toSession(raw) : null;
  }

  async findByFamily(family) {
    return Array.from(this.cache.values())
      .filter(s => s.family === family)
      .map(s => this._toSession(s));
  }

  async save(session) {
    this.cache.set(session.id, {
      id: session.id,
      userId: session.userId,
      refreshTokenHash: session.refreshTokenHash,
      family: session.family,
      createdAt: session.createdAt,
      expiresAt: session.expiresAt,
      rotatedTo: session.rotatedTo,
      revokedAt: session.revokedAt,
      metadata: session.metadata
    });
    await this.saveToFile();
    return session;
  }

  async update(session) {
    return this.save(session);
  }

  async revokeFamily(family) {
    for (const raw of this.cache.values()) {
      if (raw.family === family && !raw.revokedAt) {
        raw.revokedAt = new Date().toISOString();
      }
    }
    await this.saveToFile();
  }

  async rotate(refreshTokenHash, candidate) {
    const parent = Array.from(this.cache.values()).find(s => s.refreshTokenHash === refreshTokenHash);
    if (!parent) {
      throw new Error('Invalid refresh token');
    }
    if (parent.revokedAt) {
      throw new Error('Refresh token revoked');
    }
    if (new Date(parent.expiresAt) < new Date()) {
      throw new Error('Refresh token expired');
    }
    if (parent.rotatedTo) {
      for (const raw of this.cache.values()) {
        if (raw.family === parent.family && !raw.revokedAt) {
          raw.revokedAt = new Date().toISOString();
        }
      }
      await this.saveToFile();
      throw new Error('Refresh token reused');
    }

    parent.rotatedTo = candidate.id;
    const metadata = candidate.metadata || parent.metadata || {};
    const child = {
      id: candidate.id,
      userId: parent.userId,
      refreshTokenHash: candidate.refreshTokenHash,
      family: parent.family,
      createdAt: new Date().toISOString(),
      expiresAt: parent.expiresAt,
      rotatedTo: null,
      revokedAt: null,
      metadata
    };
    this.cache.set(parent.id, parent);
    this.cache.set(child.id, child);
    await this.saveToFile();
    return this._toSession(child);
  }
}
