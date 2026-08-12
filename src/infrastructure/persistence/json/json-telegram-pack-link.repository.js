import fs from 'fs';
import path from 'path';
import { TelegramPackLink } from '../../../domain/entities/telegram-pack-link.entity.js';
import { ITelegramPackLinkRepository } from '../../../domain/repositories/telegram-pack-link.repository.js';
import { getLogger } from '../../observability/logger.js';

export class JsonTelegramPackLinkRepository extends ITelegramPackLinkRepository {
  constructor(dataDir = '/var/www/aiStickers_Backend/data') {
    super();
    this.dbFile = path.join(dataDir, 'telegram-pack-links.json');
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
      this.cache = new Map(Object.entries(JSON.parse(fs.readFileSync(this.dbFile, 'utf8'))));
    } catch (error) {
      getLogger().error({ err: error }, 'Failed to load Telegram pack links:');
      this.cache = new Map();
    }
  }

  async saveToFile() {
    await fs.promises.writeFile(this.dbFile, JSON.stringify(Object.fromEntries(this.cache), null, 2));
  }

  _serialize(link) {
    return {
      id: link.id,
      userId: link.userId,
      telegramUserId: link.telegramUserId,
      packageId: link.packageId,
      setName: link.setName,
      status: link.status,
      stickerFileIds: link.stickerFileIds,
      stickerIdOrder: link.stickerIdOrder,
      createdAt: link.createdAt,
      updatedAt: link.updatedAt
    };
  }

  _toEntity(data) {
    return data ? new TelegramPackLink(data) : null;
  }

  async findByUserIdAndPackageId(userId, packageId) {
    return this._toEntity(Array.from(this.cache.values()).find(link =>
      link.userId === userId && link.packageId === packageId
    ));
  }

  async findBySetName(setName, userId) {
    return this._toEntity(Array.from(this.cache.values()).find(link =>
      link.setName === setName && (!userId || link.userId === userId)
    ));
  }

  async save(link) {
    this.cache.set(link.id, this._serialize(link));
    await this.saveToFile();
    return link;
  }

  async update(link, userId = link?.userId) {
    const current = this.cache.get(link.id);
    if (!current || (userId && current.userId !== userId)) return false;
    return this.save(link);
  }

  async deleteByPackageId(packageId, userId) {
    const matches = Array.from(this.cache.entries()).filter(([, link]) =>
      link.packageId === packageId && (!userId || link.userId === userId)
    );
    for (const [id] of matches) this.cache.delete(id);
    await this.saveToFile();
    return matches.length;
  }
}
