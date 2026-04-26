import fs from 'fs/promises';
import path from 'path';

/**
 * Servicio para persistir assets del usuario:
 * - Stickers generados
 * - Paquetes comprados
 * - Historial de generaciones
 * Compatible con Node.js 16+ sin dependencias nativas
 */

const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), 'data');
const ASSETS_FILE = path.join(DATA_DIR, 'userAssets.json');

let assetsCache = new Map();
let assetsDirty = false;

async function ensureDataDir() {
  try {
    await fs.mkdir(DATA_DIR, { recursive: true });
  } catch (e) {}
}

async function loadAssets() {
  try {
    await ensureDataDir();
    const data = await fs.readFile(ASSETS_FILE, 'utf8');
    const parsed = JSON.parse(data);
    assetsCache = new Map(Object.entries(parsed.users || {}));
    return true;
  } catch (e) {
    if (e.code === 'ENOENT') {
      assetsCache = new Map();
      await saveAssets();
      return true;
    }
    console.error('❌ [UserAssetsService] Error loading:', e.message);
    return false;
  }
}

async function saveAssets() {
  try {
    await ensureDataDir();
    const data = {
      version: 1,
      updatedAt: new Date().toISOString(),
      users: Object.fromEntries(assetsCache)
    };
    await fs.writeFile(ASSETS_FILE, JSON.stringify(data, null, 2));
    assetsDirty = false;
    return true;
  } catch (e) {
    console.error('❌ [UserAssetsService] Error saving:', e.message);
    return false;
  }
}

// Auto-save cada 60 segundos
setInterval(async () => {
  if (assetsDirty) await saveAssets();
}, 60000);

export class UserAssetsService {
  
  static async init() {
    await loadAssets();
    console.log('✅ [UserAssetsService] Initialized');
  }
  
  /**
   * Guarda un sticker generado por el usuario
   */
  static async saveSticker(userId, stickerData) {
    const userAssets = assetsCache.get(userId) || {
      user_id: userId,
      stickers: [],
      packages: [],
      generations: [],
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };
    
    const sticker = {
      id: `sticker_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      url: stickerData.url,
      prompt: stickerData.prompt || null,
      style: stickerData.style || null,
      created_at: new Date().toISOString(),
      metadata: stickerData.metadata || {}
    };
    
    userAssets.stickers.unshift(sticker);
    
    // Mantener solo últimos 200 stickers
    if (userAssets.stickers.length > 200) {
      userAssets.stickers = userAssets.stickers.slice(0, 200);
    }
    
    userAssets.updated_at = new Date().toISOString();
    assetsCache.set(userId, userAssets);
    assetsDirty = true;
    
    await saveAssets();
    console.log(`✅ [UserAssetsService] Sticker saved for user ${userId}`);
    
    return sticker;
  }
  
  /**
   * Obtiene stickers del usuario
   */
  static async getStickers(userId, limit = 50) {
    const userAssets = assetsCache.get(userId);
    if (!userAssets) return [];
    return userAssets.stickers.slice(0, limit);
  }
  
  /**
   * Guarda un paquete comprado
   */
  static async savePackage(userId, packageData) {
    const userAssets = assetsCache.get(userId) || {
      user_id: userId,
      stickers: [],
      packages: [],
      generations: [],
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };
    
    const pkg = {
      id: `pkg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      product_id: packageData.productId,
      name: packageData.name,
      sticker_count: packageData.stickerCount,
      price: packageData.price,
      currency: packageData.currency || 'USD',
      purchased_at: new Date().toISOString(),
      provider: packageData.provider || 'GOOGLE_PLAY',
      transaction_id: packageData.transactionId || null
    };
    
    userAssets.packages.unshift(pkg);
    userAssets.updated_at = new Date().toISOString();
    assetsCache.set(userId, userAssets);
    assetsDirty = true;
    
    await saveAssets();
    console.log(`✅ [UserAssetsService] Package saved for user ${userId}: ${pkg.name}`);
    
    return pkg;
  }
  
  /**
   * Obtiene paquetes del usuario
   */
  static async getPackages(userId) {
    const userAssets = assetsCache.get(userId);
    if (!userAssets) return [];
    return userAssets.packages;
  }
  
  /**
   * Registra una generación de imagen (para analytics)
   */
  static async logGeneration(userId, generationData) {
    const userAssets = assetsCache.get(userId) || {
      user_id: userId,
      stickers: [],
      packages: [],
      generations: [],
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };
    
    const generation = {
      id: `gen_${Date.now()}`,
      type: generationData.type || 'sticker',
      cost: generationData.cost || 1,
      status: generationData.status || 'success',
      created_at: new Date().toISOString(),
      metadata: generationData.metadata || {}
    };
    
    userAssets.generations.unshift(generation);
    
    // Mantener solo últimas 100 generaciones
    if (userAssets.generations.length > 100) {
      userAssets.generations = userAssets.generations.slice(0, 100);
    }
    
    userAssets.updated_at = new Date().toISOString();
    assetsCache.set(userId, userAssets);
    assetsDirty = true;
    
    // No guardamos inmediatamente, esperamos auto-save
    return generation;
  }
  
  /**
   * Obtiene todos los assets de un usuario (para recuperar al login)
   */
  static async getUserAssets(userId) {
    const userAssets = assetsCache.get(userId);
    if (!userAssets) {
      return {
        stickers: [],
        packages: [],
        generations_count: 0,
        created_at: null
      };
    }
    
    return {
      stickers: userAssets.stickers.slice(0, 20), // Solo últimos 20
      packages: userAssets.packages,
      generations_count: userAssets.generations?.length || 0,
      created_at: userAssets.created_at,
      updated_at: userAssets.updated_at
    };
  }
  
  /**
   * Elimina un sticker
   */
  static async deleteSticker(userId, stickerId) {
    const userAssets = assetsCache.get(userId);
    if (!userAssets) return false;
    
    const index = userAssets.stickers.findIndex(s => s.id === stickerId);
    if (index === -1) return false;
    
    userAssets.stickers.splice(index, 1);
    userAssets.updated_at = new Date().toISOString();
    assetsCache.set(userId, userAssets);
    assetsDirty = true;
    
    await saveAssets();
    return true;
  }
}

// Inicializar
UserAssetsService.init().catch(console.error);
