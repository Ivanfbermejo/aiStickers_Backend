import fs from 'node:fs';
import path from 'node:path';

/** Durable object cleanup journal. Actual deletion runs in the worker. */
export class AssetCleanupService {
  constructor({ assetService, dataDir, queue }) {
    this.assetService = assetService;
    this.queue = queue;
    this.file = path.join(dataDir, 'asset-cleanup.json');
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    if (!fs.existsSync(this.file)) fs.writeFileSync(this.file, '{}');
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
    const id = `${ownerId}:${key}`;
    const entries = await this._read();
    entries[id] ||= { id, key, ownerId, entity, confirmed: false, attempts: 0, createdAt: new Date().toISOString() };
    await this._write(entries);
    return entries[id];
  }

  async confirm(task) {
    const entries = await this._read();
    const current = entries[task.id];
    if (!current) return;
    current.confirmed = true;
    current.confirmedAt = new Date().toISOString();
    await this._write(entries);
  }

  async run(task) {
    if (this.queue) {
      const entries = await this._read();
      const current = entries[task.id];
      if (!current?.confirmed) return { deleted: false, reason: 'not_confirmed' };
      try {
        const result = await this.queue.enqueueCleanup(current);
        await this.markQueued(current);
        return { queued: true, ...result };
      } catch (error) {
        // Leave the confirmed journal row intact. The durable reconciler will
        // enqueue it after Redis returns.
        throw error;
      }
    }
    return this.process(task);
  }

  async process(task) {
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
    const entries = await this._read();
    return Object.values(entries)
      .filter(entry => entry.confirmed && !entry.queuedAt)
      .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt))
      .slice(0, limit);
  }

  async markQueued(task) {
    const entries = await this._read();
    if (entries[task.id]) {
      entries[task.id].queuedAt = new Date().toISOString();
      await this._write(entries);
    }
  }

  async cancel(task) {
    const entries = await this._read();
    delete entries[task.id];
    await this._write(entries);
  }
}
