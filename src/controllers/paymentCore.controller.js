import { PaymentCoreService } from "../services/paymentCore.service.js";
import { BalanceService } from "../services/balance.simple.service.js";
import { PlanService } from "../services/plan.service.js";
import { UserAssetsService } from "../services/userAssets.service.js";

export const PaymentCoreController = {
  async validateGooglePlayPurchase(req, res) {
    try {
      const { purchaseToken, productId, expectedAmount } = req.body;
      const userId = req.user?.sub || req.auth?.sub || 'anonymous';

      // Validar datos de entrada
      if (!purchaseToken || !productId) {
        return res.status(400).json({
          success: false,
          error: "Missing required fields: purchaseToken, productId"
        });
      }

      // 1. Detección de fraudes
      const fraudContext = {
        userId,
        action: "purchase_validation",
        ipAddress: req.ip,
        deviceFingerprint: req.headers['x-device-fingerprint'],
        amount: expectedAmount || 0,
        paymentProvider: "GOOGLE_PLAY"
      };

      const fraudAnalysis = await PaymentCoreService.fraudDetection.analyzeTransaction(userId, fraudContext);

      if (fraudAnalysis.riskScore > 0.8) {
        return res.status(400).json({
          success: false,
          error: "High fraud risk detected",
          fraudFlags: fraudAnalysis.flags,
          riskScore: fraudAnalysis.riskScore
        });
      }

      // 2. Validación con Google Play
      const validationResult = await PaymentCoreService.paymentValidation.validateGooglePlayPurchase(
        purchaseToken,
        productId
      );

      if (!validationResult.isValid) {
        return res.status(400).json({
          success: false,
          error: validationResult.errorMessage,
          fraudFlags: fraudAnalysis.flags
        });
      }

      // 3. Actualizar balance en base de datos
      const stickerCount = PlanService.getStickerCount(productId);
      const updatedBalance = await BalanceService.addBalance(userId, stickerCount, {
        transactionId: validationResult.transactionId,
        productId: productId,
        providerTransactionId: purchaseToken,
        provider: 'GOOGLE_PLAY'
      });

      // 4. Guardar paquete comprado en assets del usuario
      await UserAssetsService.savePackage(userId, {
        productId: productId,
        name: PlanService.getPlanName(productId) || productId,
        stickerCount: stickerCount,
        price: validationResult.price || PlanService.getPlanPrice(productId) || 0,
        currency: validationResult.currency || 'USD',
        provider: 'GOOGLE_PLAY',
        transactionId: validationResult.transactionId,
        providerTransactionId: purchaseToken
      });

      // 5. Respuesta exitosa
      res.json({
        success: true,
        transactionId: validationResult.transactionId,
        amount: stickerCount,
        newBalance: updatedBalance.balance,
        fraudFlags: fraudAnalysis.flags,
        riskScore: fraudAnalysis.riskScore
      });

    } catch (error) {
      console.error("Error in Google Play validation:", error);
      res.status(500).json({
        success: false,
        error: "Internal server error"
      });
    }
  },

  async validateApplePurchase(req, res) {
    try {
      const { receiptData, productId, expectedAmount } = req.body;
      const userId = req.user?.sub || req.auth?.sub || 'anonymous';

      // Validar datos de entrada
      if (!receiptData || !productId) {
        return res.status(400).json({
          success: false,
          error: "Missing required fields: receiptData, productId"
        });
      }

      // 1. Detección de fraudes
      const fraudContext = {
        userId,
        action: "purchase_validation",
        ipAddress: req.ip,
        deviceFingerprint: req.headers['x-device-fingerprint'],
        amount: expectedAmount || 0,
        paymentProvider: "APPLE_APP_STORE"
      };

      const fraudAnalysis = await PaymentCoreService.fraudDetection.analyzeTransaction(userId, fraudContext);

      if (fraudAnalysis.riskScore > 0.8) {
        return res.status(400).json({
          success: false,
          error: "High fraud risk detected",
          fraudFlags: fraudAnalysis.flags,
          riskScore: fraudAnalysis.riskScore
        });
      }

      // 2. Validación con Apple App Store
      const validationResult = await PaymentCoreService.paymentValidation.validateApplePurchase(
        receiptData,
        productId
      );

      if (!validationResult.isValid) {
        return res.status(400).json({
          success: false,
          error: validationResult.errorMessage,
          fraudFlags: fraudAnalysis.flags
        });
      }

      // 3. Actualizar balance en base de datos (SQLite)
      const stickerCount = PlanService.getStickerCount(productId);
      const updatedBalance = await BalanceService.addBalance(userId, stickerCount, {
        transactionId: validationResult.transactionId,
        productId: productId,
        providerTransactionId: receiptData,
        provider: 'APPLE_APP_STORE'
      });

      // 4. Respuesta exitosa
      res.json({
        success: true,
        transactionId: validationResult.transactionId,
        amount: stickerCount,
        newBalance: updatedBalance.balance,
        fraudFlags: fraudAnalysis.flags,
        riskScore: fraudAnalysis.riskScore
      });

    } catch (error) {
      console.error("Error in Apple validation:", error);
      res.status(500).json({
        success: false,
        error: "Internal server error"
      });
    }
  },

  async getBalance(req, res) {
    try {
      const userId = req.params.userId || req.user?.sub || req.auth?.sub;

      if (!userId) {
        return res.status(400).json({
          success: false,
          error: "User ID is required"
        });
      }

      const balance = await BalanceService.getBalance(userId);
      const stats = await BalanceService.getUserStats(userId);

      res.json({
        success: true,
        userId,
        balance,
        stats: stats || { sticker_dollars: balance, total_purchased: 0, total_spent: 0 },
        currency: "USD"
      });

    } catch (error) {
      console.error("Error getting balance:", error);
      res.status(500).json({
        success: false,
        error: "Internal server error"
      });
    }
  },

  async analyzeFraud(req, res) {
    try {
      const { userId, action, amount, paymentProvider } = req.body;
      const requestUserId = req.user?.sub || req.auth?.sub;

      if (!userId || !action) {
        return res.status(400).json({
          success: false,
          error: "Missing required fields: userId, action"
        });
      }

      const fraudContext = {
        userId,
        action,
        ipAddress: req.ip,
        deviceFingerprint: req.headers['x-device-fingerprint'],
        amount: amount || 0,
        paymentProvider: paymentProvider || "UNKNOWN"
      };

      const analysis = await PaymentCoreService.fraudDetection.analyzeTransaction(userId, fraudContext);

      res.json({
        success: true,
        analysis: {
          riskScore: analysis.riskScore,
          recommendation: analysis.recommendation,
          flags: analysis.flags,
          analyzedAt: new Date()
        }
      });

    } catch (error) {
      console.error("Error in fraud analysis:", error);
      res.status(500).json({
        success: false,
        error: "Internal server error"
      });
    }
  },

  async getPackages(req, res) {
    try {
      // Lista de paquetes disponibles
      const packages = [
        {
          id: "basic_pack_android",
          name: "Basic Pack",
          description: "100 stickers",
          price: 4.99,
          currency: "USD",
          platform: "android"
        },
        {
          id: "premium_pack_android",
          name: "Premium Pack",
          description: "500 stickers",
          price: 9.99,
          currency: "USD",
          platform: "android"
        },
        {
          id: "basic_pack_ios",
          name: "Basic Pack",
          description: "100 stickers",
          price: 4.99,
          currency: "USD",
          platform: "ios"
        },
        {
          id: "premium_pack_ios",
          name: "Premium Pack",
          description: "500 stickers",
          price: 9.99,
          currency: "USD",
          platform: "ios"
        }
      ];

      res.json({
        success: true,
        packages
      });

    } catch (error) {
      console.error("Error getting packages:", error);
      res.status(500).json({
        success: false,
        error: "Internal server error"
      });
    }
  }
};
