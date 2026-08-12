import fs from 'node:fs';
import path from 'node:path';

/**
 * Durable object cleanup coordinator. PostgreSQL is used by the application
 * driver; the JSON journal remains only as a development/test fallback.
 */
export class AssetCleanupService {
  constructor({ assetService, dataDir, queue, taskRepository, lockTimeoutMs = 5 * 60 * 1000 }) {
    this.assetService = assetService;
    this.queue = queue;
    this.taskRepository = taskRepository;
    this.lockTimeoutMs = lockTimeoutMs;

    if (!this.taskRepository) {
      this.file = path.join(dataDir, 'asset-cleanup.json');
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      if (!fs.existsSync(this.file)) fs.writeFileSync(this.file, '{}');
    }
  }

  async _read() {
    try { return JSON.parse(await fs.promises.readFile(this.file, 'utf8')); } catch { return {}; }
  }

  async _write(entries) {
    const temp = `${this.file}.tmp-${process.pid}`;
    await fs.promises.writeFile(temp, JSON.stringify(entries, null, 2));
    await fs.promises.rename(temp, this.file);
  }

  async schedule({ key, ownerId, entity }) {
    if (this.taskRepository) return this.taskRepository.schedule({ key, ownerId, entity });

    const id = `${ownerId}:${key}`;
    const entries = await this._read();
    entries[id] ||= { id, key, ownerId, entity, confirmed: false, attempts: 0, createdAt: new Date().toISOString() };
    await this._write(entries);
    return entries[id];
  }

  async confirm(task) {
    if (this.taskRepository) return this.taskRepository.confirm(task);

    const entries = await this._read();
    const current = entries[task.id];
    if (!current) return;
    current.confirmed = true;
    current.confirmedAt = new Date().toISOString();
    await this._write(entries);
  }

  async run(task) {
    const current = this.taskRepository
      ? await this.taskRepository.findById(task.id)
      : (await this._read())[task.id];
    if (current?.status === 'completed' || current?.status === 'cancelled') {
      return { deleted: false, reason: 'already_terminal' };
    }
    if (!current || (!current.confirmed && current.status !== 'confirmed' && current.status !== 'queued')) {
      return { deleted: false, reason: 'not_confirmed' };
    }

    if (this.queue) {
      try {
        const result = await this.queue.enqueueCleanup(current);
        if (result.enqueued) await this.markQueued(current);
        return { queued: true, ...result };
      } catch (error) {
        // Keep the confirmed/queued row. The reconciler will retry after Redis
        // becomes available.
        throw error;
      }
    }
    return this.process(current);
  }

  async process(task) {
    if (this.taskRepository) {
      const claimed = await this.taskRepository.claim(task.id, this.lockTimeoutMs);
      if (!claimed) return { deleted: false, reason: 'claimed_by_other_worker' };
      try {
        const result = await this.assetService.deleteIfOwned(claimed.key, claimed.ownerId);
        await this.taskRepository.complete(claimed);
        return result;
      } catch (error) {
        await this.taskRepository.fail(claimed, error).catch(() => {});
        throw error;
      }
    }

    const entries = await this._read();
    const current = entries[task.id];
    if (!current?.confirmed) return { deleted: false, reason: 'not_confirmed' };
    current.attempts += 1;
    current.lastAttemptAt = new Date().toISOString();
    await this._write(entries);
    try {
      const result = await this.assetService.deleteIfOwned(current.key, current.ownerId);
      const latest = await this._read();
      delete latest[current.id];
      await this._write(latest);
      return result;
    } catch (error) {
      const latest = await this._read();
      if (latest[current.id]) latest[current.id].lastError = error.message;
      await this._write(latest);
      throw error;
    }
  }

  async findConfirmedPending(limit = 100) {
    if (this.taskRepository) return this.taskRepository.findConfirmedPending(limit);
    const entries = await this._read();
    return Object.values(entries)
      .filter(entry => entry.confirmed && !entry.queuedAt)
      .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt))
      .slice(0, limit);
  }

  async markQueued(task) {
    if (this.taskRepository) return this.taskRepository.markQueued(task);
    const entries = await this._read();
    if (entries[task.id]) {
      entries[task.id].queuedAt = new Date().toISOString();
      await this._write(entries);
    }
  }

  async cancel(task) {
    if (this.taskRepository) return this.taskRepository.cancel(task);
    const entries = await this._read();
    delete entries[task.id];
    await this._write(entries);
  }
}
