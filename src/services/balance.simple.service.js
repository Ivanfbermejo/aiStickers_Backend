import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';

/**
 * Servicio de balance simplificado usando JSON file
 * Compatible con Node.js 16+ sin dependencias nativas
 * Para producción con alto tráfico, migrar a PostgreSQL/MySQL
 */

const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), 'data');
const DB_FILE = path.join(DATA_DIR, 'balances.json');

// Cache en memoria para performance
let memoryCache = new Map();
let cacheDirty = false;

async function ensureDataDir() {
  try {
    await fs.mkdir(DATA_DIR, { recursive: true });
  } catch (e) {
    // Ignorar si ya existe
  }
}

async function loadDatabase() {
  try {
    await ensureDataDir();
    const data = await fs.readFile(DB_FILE, 'utf8');
    const parsed = JSON.parse(data);
    memoryCache = new Map(Object.entries(parsed.balances || {}));
    return true;
  } catch (e) {
    if (e.code === 'ENOENT') {
      // Archivo no existe, crear vacío
      memoryCache = new Map();
      await saveDatabase();
      return true;
    }
    console.error('❌ [BalanceService] Error loading database:', e.message);
    return false;
  }
}

async function saveDatabase() {
  try {
    await ensureDataDir();
    const data = {
      version: 1,
      updatedAt: new Date().toISOString(),
      balances: Object.fromEntries(memoryCache)
    };
    await fs.writeFile(DB_FILE, JSON.stringify(data, null, 2));
    cacheDirty = false;
    return true;
  } catch (e) {
    console.error('❌ [BalanceService] Error saving database:', e.message);
    return false;
  }
}

// Auto-save cada 30 segundos si hay cambios pendientes
setInterval(async () => {
  if (cacheDirty) {
    await saveDatabase();
  }
}, 30000);

export class BalanceService {
  
  static async init() {
    await loadDatabase();
    console.log('✅ [BalanceService] Database initialized (JSON file)');
  }
  
  /**
   * Obtiene el balance actual de un usuario
   */
  static async getBalance(userId) {
    const userData = memoryCache.get(userId);
    const balance = userData ? userData.sticker_dollars : 0;
    console.log(`📊 [BalanceService] getBalance(${userId}): ${balance}, transactions: ${userData?.transactions?.length || 0}`);
    return balance;
  }
  
  /**
   * Añade StickerDollars a un usuario (después de compra)
   */
  static async addBalance(userId, amount, metadata = {}) {
    const transactionId = metadata.transactionId || `txn_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    try {
      // Obtener o crear usuario
      let userData = memoryCache.get(userId) || {
        user_id: userId,
        sticker_dollars: 0,
        total_purchased: 0,
        total_spent: 0,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        transactions: []
      };
      
      // Calcular nuevo balance
      const currentBalance = userData.sticker_dollars;
      const newBalance = currentBalance + amount;
      
      // Actualizar datos
      userData.sticker_dollars = newBalance;
      userData.total_purchased += amount;
      userData.updated_at = new Date().toISOString();
      
      // Registrar transacción
      userData.transactions.unshift({
        id: transactionId,
        type: 'PURCHASE',
        amount: amount,
        balance_after: newBalance,
        product_id: metadata.productId || null,
        transaction_id: metadata.providerTransactionId || null,
        provider: metadata.provider || 'GOOGLE_PLAY',
        created_at: new Date().toISOString()
      });
      
      // Mantener solo últimas 100 transacciones por usuario
      if (userData.transactions.length > 100) {
        userData.transactions = userData.transactions.slice(0, 100);
      }
      
      // Guardar en cache
      memoryCache.set(userId, userData);
      cacheDirty = true;
      
      // Persistir inmediatamente para compras
      await saveDatabase();
      
      // Verificar que se guardó correctamente
      const verifyData = memoryCache.get(userId);
      console.log(`✅ [BalanceService] Added ${amount} StickerDollars to user ${userId}. New balance: ${newBalance}, Verified: ${verifyData?.sticker_dollars}`);
      
      return {
        userId,
        balance: newBalance,
        transactionId,
        amount
      };
      
    } catch (error) {
      console.error('❌ [BalanceService] Error adding balance:', error);
      throw error;
    }
  }
  
  /**
   * Gasta StickerDollars (cuando usuario genera imagen)
   */
  static async spendBalance(userId, amount = 1) {
    const transactionId = `spend_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    try {
      let userData = memoryCache.get(userId);
      
      if (!userData || userData.sticker_dollars < amount) {
        const currentBalance = userData ? userData.sticker_dollars : 0;
        return {
          success: false,
          error: 'INSUFFICIENT_BALANCE',
          message: `Need ${amount} StickerDollars, have ${currentBalance}`,
          currentBalance
        };
      }
      
      const newBalance = userData.sticker_dollars - amount;
      
      // Actualizar datos
      userData.sticker_dollars = newBalance;
      userData.total_spent += amount;
      userData.updated_at = new Date().toISOString();
      
      // Registrar transacción
      userData.transactions.unshift({
        id: transactionId,
        type: 'SPEND',
        amount: -amount,
        balance_after: newBalance,
        transaction_id: transactionId,
        provider: 'SYSTEM',
        created_at: new Date().toISOString()
      });
      
      // Guardar
      memoryCache.set(userId, userData);
      cacheDirty = true;
      await saveDatabase();
      
      console.log(`✅ [BalanceService] Spent ${amount} StickerDollars from user ${userId}. Remaining: ${newBalance}`);
      
      return {
        success: true,
        userId,
        balance: newBalance,
        transactionId,
        amount
      };
      
    } catch (error) {
      console.error('❌ [BalanceService] Error spending balance:', error);
      throw error;
    }
  }
  
  /**
   * Obtiene el historial de transacciones de un usuario
   */
  static async getTransactionHistory(userId, limit = 50) {
    const userData = memoryCache.get(userId);
    if (!userData || !userData.transactions) return [];
    return userData.transactions.slice(0, limit);
  }
  
  /**
   * Obtiene estadísticas del usuario
   */
  static async getUserStats(userId) {
    const userData = memoryCache.get(userId);
    if (!userData) return null;
    
    return {
      sticker_dollars: userData.sticker_dollars,
      total_purchased: userData.total_purchased,
      total_spent: userData.total_spent,
      usage_rate: userData.total_purchased > 0 
        ? (userData.total_spent * 100.0 / userData.total_purchased) 
        : 0,
      created_at: userData.created_at,
      updated_at: userData.updated_at
    };
  }
  
  /**
   * Fuerza guardado en disco (útil para backups)
   */
  static async forceSave() {
    if (cacheDirty) {
      return await saveDatabase();
    }
    return true;
  }
  
  /**
   * Obtiene estadísticas globales (para admin)
   */
  static async getGlobalStats() {
    let totalUsers = 0;
    let totalStickerDollars = 0;
    let totalPurchased = 0;
    let totalSpent = 0;
    
    for (const [userId, userData] of memoryCache) {
      totalUsers++;
      totalStickerDollars += userData.sticker_dollars || 0;
      totalPurchased += userData.total_purchased || 0;
      totalSpent += userData.total_spent || 0;
    }
    
    return {
      totalUsers,
      totalStickerDollars,
      totalPurchased,
      totalSpent,
      activeBalances: totalStickerDollars
    };
  }
}

// Inicializar al cargar el módulo
BalanceService.init().catch(console.error);
