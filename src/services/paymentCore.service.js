import crypto from 'crypto';
import { PlanService } from './plan.service.js';

class FraudDetectionService {
  constructor() {
    this.riskThresholds = {
      high: 0.8,
      medium: 0.6,
      low: 0.3
    };
  }

  async analyzeTransaction(userId, context) {
    const flags = [];
    let riskScore = 0;

    // 1. Múltiples compras en tiempo corto
    const rapidPurchasesFlag = await this.checkRapidPurchases(userId, context);
    if (rapidPurchasesFlag) {
      flags.push(rapidPurchasesFlag);
      riskScore += 0.3;
    }

    // 2. Monto inusualmente alto
    const unusualAmountFlag = await this.checkUnusualAmount(userId, context.amount);
    if (unusualAmountFlag) {
      flags.push(unusualAmountFlag);
      riskScore += 0.2;
    }

    // 3. Cambio de ubicación sospechoso
    if (context.ipAddress) {
      const locationFlag = await this.checkLocationAnomaly(userId, context.ipAddress);
      if (locationFlag) {
        flags.push(locationFlag);
        riskScore += 0.25;
      }
    }

    // 4. Device fingerprint sospechoso
    if (context.deviceFingerprint) {
      const deviceFlag = await this.checkDeviceAnomaly(userId, context.deviceFingerprint);
      if (deviceFlag) {
        flags.push(deviceFlag);
        riskScore += 0.4;
      }
    }

    // 5. Lista negra
    const blacklistFlag = await this.checkBlacklist(userId, context);
    if (blacklistFlag) {
      flags.push(blacklistFlag);
      riskScore += 0.8;
    }

    return {
      riskScore: Math.min(riskScore, 1.0),
      flags,
      recommendation: this.getRecommendation(riskScore)
    };
  }

  async checkRapidPurchases(userId, context) {
    // Simular consulta a base de datos
    // En implementación real, consultar transacciones de la última hora
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    const recentTransactions = await this.getRecentTransactions(userId, oneHourAgo);
    
    const purchaseCount = recentTransactions.filter(t => 
      t.type === 'PURCHASE' && t.status === 'COMPLETED'
    ).length;

    if (purchaseCount >= 5) {
      return {
        type: 'RAPID_MULTIPLE_PURCHASES',
        severity: 'HIGH',
        description: `${purchaseCount} purchases in the last hour`,
        detectedAt: new Date()
      };
    }
    return null;
  }

  async checkUnusualAmount(userId, currentAmount) {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const historicalTransactions = await this.getRecentTransactions(userId, thirtyDaysAgo);

    if (historicalTransactions.length === 0) return null;

    const purchaseAmounts = historicalTransactions
      .filter(t => t.type === 'PURCHASE')
      .map(t => t.amount);

    const averageAmount = purchaseAmounts.reduce((a, b) => a + b, 0) / purchaseAmounts.length;
    const threshold = averageAmount * 3.0;

    if (currentAmount > threshold) {
      return {
        type: 'UNUSUAL_PURCHASE_PATTERN',
        severity: 'MEDIUM',
        description: `Purchase amount ${currentAmount} is significantly higher than average ${averageAmount}`,
        detectedAt: new Date()
      };
    }
    return null;
  }

  async checkLocationAnomaly(userId, ipAddress) {
    const recentLocations = await this.getRecentLocations(userId, 7);
    const currentCountry = this.getCountryFromIp(ipAddress);
    const previousCountries = [...new Set(recentLocations.map(loc => loc.country))];

    if (previousCountries.length > 0 && !previousCountries.includes(currentCountry)) {
      return {
        type: 'UNUSUAL_LOCATION',
        severity: 'MEDIUM',
        description: `Login from new country: ${currentCountry} (previous: ${previousCountries.join(', ')})`,
        detectedAt: new Date()
      };
    }
    return null;
  }

  async checkDeviceAnomaly(userId, deviceFingerprint) {
    const recentDevices = await this.getRecentDevices(userId, 30);

    if (!recentDevices.includes(deviceFingerprint)) {
      return {
        type: 'ACCOUNT_TAKEOVER_SUSPICION',
        severity: 'HIGH',
        description: 'Login from new device',
        detectedAt: new Date()
      };
    }
    return null;
  }

  async checkBlacklist(userId, context) {
    const isBlacklisted = await this.isUserBlacklisted(userId);

    if (isBlacklisted) {
      return {
        type: 'ACCOUNT_TAKEOVER_SUSPICION',
        severity: 'CRITICAL',
        description: 'User is on blacklist',
        detectedAt: new Date()
      };
    }
    return null;
  }

  getCountryFromIp(ipAddress) {
    // Implementar geolocalización de IP
    // Por ahora retorna un placeholder
    return 'US';
  }

  getRecommendation(riskScore) {
    if (riskScore >= this.riskThresholds.high) return 'BLOCK';
    if (riskScore >= this.riskThresholds.medium) return 'MANUAL_REVIEW';
    if (riskScore >= this.riskThresholds.low) return 'ADDITIONAL_VERIFICATION';
    return 'ALLOW';
  }

  // Métodos simulados - en implementación real conectarían a base de datos
  async getRecentTransactions(userId, since) {
    // Simular datos de transacciones
    return [];
  }

  async getRecentLocations(userId, days) {
    return [];
  }

  async getRecentDevices(userId, days) {
    return [];
  }

  async isUserBlacklisted(userId) {
    return false;
  }
}

class PaymentValidationService {
  constructor() {
    this.fraudDetection = new FraudDetectionService();
  }

  async validateGooglePlayPurchase(token, productId) {
    try {
      // Implementar validación real con Google Play API
      // Por ahora simulamos validación exitosa
      const isValid = await this.verifyGooglePlayToken(token);
      
      if (!isValid) {
        return {
          isValid: false,
          errorMessage: 'Invalid purchase token'
        };
      }

      const amount = this.getAmountFromPackage(productId);
      const transactionId = this.generateTransactionId();

      return {
        isValid: true,
        amount,
        transactionId,
        providerTransactionId: token
      };
    } catch (error) {
      return {
        isValid: false,
        errorMessage: error.message
      };
    }
  }

  async validateApplePurchase(receiptData, productId) {
    try {
      // Implementar validación real con Apple App Store API
      const isValid = await this.verifyAppleReceipt(receiptData);
      
      if (!isValid) {
        return {
          isValid: false,
          errorMessage: 'Invalid receipt data'
        };
      }

      const amount = this.getAmountFromPackage(productId);
      const transactionId = this.generateTransactionId();

      return {
        isValid: true,
        amount,
        transactionId,
        providerTransactionId: receiptData
      };
    } catch (error) {
      return {
        isValid: false,
        errorMessage: error.message
      };
    }
  }

  async verifyGooglePlayToken(token) {
    // Implementar verificación real con clave pública de Google Play
    // Por ahora simulamos validación
    return token && token.length > 10;
  }

  async verifyAppleReceipt(receiptData) {
    // Implementar verificación real con Apple servers
    // Por ahora simulamos validación
    return receiptData && receiptData.length > 10;
  }

  getAmountFromPackage(productId) {
    // Usar PlanService para obtener stickerCount (1 StickerDollar = 1 imagen)
    return PlanService.getStickerCount(productId);
  }

  generateTransactionId() {
    return crypto.randomUUID();
  }
}


export const PaymentCoreService = {
  fraudDetection: new FraudDetectionService(),
  paymentValidation: new PaymentValidationService()
};
