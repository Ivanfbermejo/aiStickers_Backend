import fs from 'fs';
import path from 'path';
import { GenerationJob } from '../../../domain/entities/generation-job.entity.js';
import { IGenerationJobRepository } from '../../../domain/repositories/generation-job.repository.js';

/**
 * JSON GenerationJob Repository Implementation
 * Uses JSON file for persistence
 */
export class JsonGenerationJobRepository extends IGenerationJobRepository {
  constructor(dataDir = '/var/www/aiStickers_Backend/data') {
    super();
    this.dbFile = path.join(dataDir, 'generation-jobs.json');
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
      console.error('Failed to load generation jobs:', err);
      this.cache = new Map();
    }
  }

  async saveToFile() {
    const data = Object.fromEntries(this.cache);
    await fs.promises.writeFile(this.dbFile, JSON.stringify(data, null, 2));
  }

  _serialize(job) {
    return {
      id: job.id,
      userId: job.userId,
      type: job.type,
      status: job.status,
      currentStep: job.currentStep,
      progress: job.progress,
      packageId: job.packageId,
      stickerId: job.stickerId,
      input: job.input,
      result: job.result,
      provider: job.provider,
      cost: job.cost,
      errorMessage: job.errorMessage,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt
    };
  }

  async save(job) {
    this.cache.set(job.id, this._serialize(job));
    await this.saveToFile();
    return job;
  }

  async update(job) {
    return this.save(job);
  }

  async findById(id) {
    const data = this.cache.get(id);
    if (!data) return null;
    return new GenerationJob(data);
  }

  async findByUserId(userId) {
    const jobs = Array.from(this.cache.values())
      .filter(j => j.userId === userId)
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    return jobs.map(j => new GenerationJob(j));
  }

  async findPending() {
    const jobs = Array.from(this.cache.values())
      .filter(j => j.status === 'queued')
      .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
    return jobs.map(j => new GenerationJob(j));
  }

  async findByStickerId(stickerId) {
    const data = Array.from(this.cache.values()).find(j => j.stickerId === stickerId);
    if (!data) return null;
    return new GenerationJob(data);
  }

  async delete(id) {
    this.cache.delete(id);
    await this.saveToFile();
    return true;
  }

  async deleteByUserId(userId) {
    const toDelete = Array.from(this.cache.entries())
      .filter(([_, j]) => j.userId === userId);
    for (const [id, _] of toDelete) {
      this.cache.delete(id);
    }
    await this.saveToFile();
    return toDelete.length;
  }
}
