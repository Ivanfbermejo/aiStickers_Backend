import fetch from "node-fetch";
import { PlanService } from "./plan.service.js";

/**
 * Servicio de validación de pagos
 * Usa PlanService para obtener metadatos de productos
 */

export class PaymentService {

  // ─── Google Play ─────────────────────────────────────────────────────────────

  static async validateGooglePlay({ purchaseToken, productId }) {
    const packageName = process.env.ANDROID_PACKAGE_NAME;
    const serviceAccountJson = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;

    if (!packageName || !serviceAccountJson) {
      throw new Error("Missing ANDROID_PACKAGE_NAME or GOOGLE_SERVICE_ACCOUNT_JSON env vars");
    }
    console.log(`📦 [PAYMENT] Validating with packageName: ${packageName}, productId: ${productId}`);

    // Obtener access token de Google usando Service Account
    const accessToken = await PaymentService._getGoogleAccessToken(serviceAccountJson);

    // Llamar a Google Play Developer API para verificar la compra
    const url = `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${packageName}/purchases/products/${productId}/tokens/${purchaseToken}`;
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!response.ok) {
      const body = await response.text();
      console.error(`❌ [PAYMENT] GP API ${response.status} for package=${packageName} product=${productId}: ${body}`);
      throw new Error(`Google Play API error ${response.status}: ${body}`);
    }

    const purchase = await response.json();
    console.log("📦 [PAYMENT] Google Play purchase response:", JSON.stringify(purchase));

    // purchaseState: 0 = purchased, 1 = canceled, 2 = pending
    if (purchase.purchaseState === 1) {
      throw new Error(`Purchase cancelled. State: ${purchase.purchaseState}`);
    }
    
    // Si está pendiente, devolver estado especial para guardar y verificar después
    if (purchase.purchaseState === 2) {
      const stickerCount = PlanService.getStickerCount(productId);
      return {
        valid: false,
        pending: true,
        stickerCount: stickerCount,
        orderId: purchase.orderId,
        message: "Purchase is pending — balance will be added once payment is confirmed"
      };
    }

    // consumptionState: 0 = not consumed - evitar duplicados
    if (purchase.consumptionState === 1) {
      throw new Error("Purchase already consumed (duplicate)");
    }

    // Obtener stickerCount desde PlanService (fuente única de verdad)
    const stickerCount = PlanService.getStickerCount(productId);
    if (stickerCount === 0) {
      throw new Error(`Unknown productId: ${productId}`);
    }

    return {
      valid: true,
      stickerCount: stickerCount,
      orderId: purchase.orderId,
    };
  }

  // ─── Apple App Store ─────────────────────────────────────────────────────────

  static async validateApple({ receiptData, productId }) {
    const sharedSecret = process.env.APPLE_SHARED_SECRET;
    if (!sharedSecret) {
      throw new Error("Missing APPLE_SHARED_SECRET env var");
    }

    // Intentar primero producción, si falla con 21007 usar sandbox
    const result = await PaymentService._verifyAppleReceipt(receiptData, sharedSecret, false);
    const statusCode = result.status;

    if (statusCode === 21007) {
      // Recibo de sandbox enviado a producción → reintentar en sandbox
      console.log("🍎 [PAYMENT] Retrying with Apple sandbox");
      return PaymentService._processAppleResult(
        await PaymentService._verifyAppleReceipt(receiptData, sharedSecret, true),
        productId
      );
    }

    return PaymentService._processAppleResult(result, productId);
  }

  static async _verifyAppleReceipt(receiptData, sharedSecret, sandbox) {
    const url = sandbox
      ? "https://sandbox.itunes.apple.com/verifyReceipt"
      : "https://buy.itunes.apple.com/verifyReceipt";

    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ "receipt-data": receiptData, password: sharedSecret }),
    });

    return response.json();
  }

  static _processAppleResult(result, productId) {
    if (result.status !== 0) {
      throw new Error(`Apple receipt invalid. Status: ${result.status}`);
    }

    const latestReceipt = result.latest_receipt_info?.[0];
    if (!latestReceipt) {
      throw new Error("No receipt info found");
    }

    if (latestReceipt.product_id !== productId) {
      throw new Error(`productId mismatch: expected ${productId}, got ${latestReceipt.product_id}`);
    }

    // Obtener stickerCount desde PlanService (fuente única de verdad)
    const stickerCount = PlanService.getStickerCount(productId);
    if (stickerCount === 0) {
      throw new Error(`Unknown productId: ${productId}`);
    }

    return {
      valid: true,
      stickerCount: stickerCount,
      transactionId: latestReceipt.transaction_id,
    };
  }

  // ─── Helper: Google Service Account Auth ─────────────────────────────────────

  static async _getGoogleAccessToken(serviceAccountJson) {
    const { GoogleAuth } = await import("google-auth-library");
    const credentials = JSON.parse(serviceAccountJson);
    const auth = new GoogleAuth({
      credentials,
      scopes: ["https://www.googleapis.com/auth/androidpublisher"],
    });
    const client = await auth.getClient();
    const tokenResponse = await client.getAccessToken();
    return tokenResponse.token;
  }
}
