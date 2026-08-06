import fs from 'node:fs';
import path from 'node:path';

/** Durable, best-effort object cleanup journal (T08 can consume it later). */
export class AssetCleanupService {
  constructor({ assetService, dataDir }) {
    this.assetService = assetService;
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

  async cancel(task) {
    const entries = await this._read();
    delete entries[task.id];
    await this._write(entries);
  }
}
