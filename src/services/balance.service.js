import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import path from 'path';

/**
 * Servicio de gestión de balance StickerDollars
 * Persistencia en SQLite para producción inicial
 */

let db = null;

async function getDb() {
  if (!db) {
    const dbPath = process.env.DATABASE_PATH || path.join(process.cwd(), 'data', 'stickers.db');
    db = await open({
      filename: dbPath,
      driver: sqlite3.Database
    });
    
    // Crear tabla si no existe
    await db.exec(`
      CREATE TABLE IF NOT EXISTS user_balances (
        user_id TEXT PRIMARY KEY,
        sticker_dollars INTEGER DEFAULT 0,
        total_purchased INTEGER DEFAULT 0,
        total_spent INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        version INTEGER DEFAULT 1
      );
      
      CREATE TABLE IF NOT EXISTS balance_transactions (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        type TEXT NOT NULL, -- 'PURCHASE', 'SPEND', 'REFUND', 'BONUS'
        amount INTEGER NOT NULL,
        balance_after INTEGER NOT NULL,
        product_id TEXT,
        transaction_id TEXT,
        provider TEXT, -- 'GOOGLE_PLAY', 'APPLE_APP_STORE', 'ADMIN'
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES user_balances(user_id)
      );
      
      CREATE INDEX IF NOT EXISTS idx_transactions_user ON balance_transactions(user_id);
      CREATE INDEX IF NOT EXISTS idx_transactions_created ON balance_transactions(created_at);
    `);
    
    console.log('✅ [BalanceService] Database initialized');
  }
  return db;
}

export class BalanceService {
  
  /**
   * Obtiene el balance actual de un usuario
   * @param {string} userId - ID único del usuario (sub del JWT)
   * @returns {Promise<number>} - Cantidad de StickerDollars
   */
  static async getBalance(userId) {
    try {
      const db = await getDb();
      const row = await db.get(
        'SELECT sticker_dollars FROM user_balances WHERE user_id = ?',
        [userId]
      );
      return row ? row.sticker_dollars : 0;
    } catch (error) {
      console.error('❌ [BalanceService] Error getting balance:', error);
      throw error;
    }
  }
  
  /**
   * Añade StickerDollars a un usuario (después de compra)
   * @param {string} userId - ID del usuario
   * @param {number} amount - Cantidad a añadir
   * @param {Object} metadata - Datos de la transacción
   */
  static async addBalance(userId, amount, metadata = {}) {
    const db = await getDb();
    const transactionId = metadata.transactionId || `txn_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    try {
      await db.run('BEGIN TRANSACTION');
      
      // 1. Obtener balance actual con lock
      const current = await db.get(
        'SELECT sticker_dollars, version FROM user_balances WHERE user_id = ?',
        [userId]
      );
      
      const currentBalance = current ? current.sticker_dollars : 0;
      const newBalance = currentBalance + amount;
      const version = current ? current.version + 1 : 1;
      
      // 2. Actualizar o insertar balance
      if (current) {
        await db.run(
          `UPDATE user_balances 
           SET sticker_dollars = ?, 
               total_purchased = total_purchased + ?,
               updated_at = CURRENT_TIMESTAMP,
               version = ?
           WHERE user_id = ?`,
          [newBalance, amount, version, userId]
        );
      } else {
        await db.run(
          `INSERT INTO user_balances (user_id, sticker_dollars, total_purchased, version)
           VALUES (?, ?, ?, ?)`,
          [userId, newBalance, amount, version]
        );
      }
      
      // 3. Registrar transacción
      await db.run(
        `INSERT INTO balance_transactions 
         (id, user_id, type, amount, balance_after, product_id, transaction_id, provider)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          transactionId,
          userId,
          'PURCHASE',
          amount,
          newBalance,
          metadata.productId || null,
          metadata.providerTransactionId || null,
          metadata.provider || 'GOOGLE_PLAY'
        ]
      );
      
      await db.run('COMMIT');
      
      console.log(`✅ [BalanceService] Added ${amount} StickerDollars to user ${userId}. New balance: ${newBalance}`);
      
      return {
        userId,
        balance: newBalance,
        transactionId,
        amount
      };
      
    } catch (error) {
      await db.run('ROLLBACK');
      console.error('❌ [BalanceService] Error adding balance:', error);
      throw error;
    }
  }
  
  /**
   * Gasta StickerDollars (cuando usuario genera imagen)
   * @param {string} userId - ID del usuario
   * @param {number} amount - Cantidad a gastar (normalmente 1)
   * @returns {Promise<Object>} - Resultado de la operación
   */
  static async spendBalance(userId, amount = 1) {
    const db = await getDb();
    const transactionId = `spend_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    try {
      await db.run('BEGIN TRANSACTION');
      
      // Verificar balance con lock
      const current = await db.get(
        'SELECT sticker_dollars, version FROM user_balances WHERE user_id = ?',
        [userId]
      );
      
      if (!current || current.sticker_dollars < amount) {
        await db.run('ROLLBACK');
        return {
          success: false,
          error: 'INSUFFICIENT_BALANCE',
          message: `Need ${amount} StickerDollars, have ${current ? current.sticker_dollars : 0}`
        };
      }
      
      const newBalance = current.sticker_dollars - amount;
      
      // Actualizar balance
      await db.run(
        `UPDATE user_balances 
         SET sticker_dollars = ?, 
             total_spent = total_spent + ?,
             updated_at = CURRENT_TIMESTAMP,
             version = version + 1
         WHERE user_id = ?`,
        [newBalance, amount, userId]
      );
      
      // Registrar transacción
      await db.run(
        `INSERT INTO balance_transactions 
         (id, user_id, type, amount, balance_after, transaction_id, provider)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [transactionId, userId, 'SPEND', -amount, newBalance, transactionId, 'SYSTEM']
      );
      
      await db.run('COMMIT');
      
      console.log(`✅ [BalanceService] Spent ${amount} StickerDollars from user ${userId}. Remaining: ${newBalance}`);
      
      return {
        success: true,
        userId,
        balance: newBalance,
        transactionId,
        amount
      };
      
    } catch (error) {
      await db.run('ROLLBACK');
      console.error('❌ [BalanceService] Error spending balance:', error);
      throw error;
    }
  }
  
  /**
   * Obtiene el historial de transacciones de un usuario
   * @param {string} userId - ID del usuario
   * @param {number} limit - Límite de resultados
   */
  static async getTransactionHistory(userId, limit = 50) {
    const db = await getDb();
    return db.all(
      `SELECT * FROM balance_transactions 
       WHERE user_id = ? 
       ORDER BY created_at DESC 
       LIMIT ?`,
      [userId, limit]
    );
  }
  
  /**
   * Obtiene estadísticas del usuario
   * @param {string} userId - ID del usuario
   */
  static async getUserStats(userId) {
    const db = await getDb();
    return db.get(
      `SELECT sticker_dollars, total_purchased, total_spent, 
              (total_spent * 100.0 / NULLIF(total_purchased, 0)) as usage_rate,
              created_at, updated_at
       FROM user_balances 
       WHERE user_id = ?`,
      [userId]
    );
  }
}
