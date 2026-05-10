import { Purchase } from '../../../domain/entities/purchase.entity.js';
import { Transaction } from '../../../domain/entities/transaction.entity.js';

/**
 * Validate Purchase Use Case
 * Orchestrates the validation of a store purchase (Google Play/Apple)
 * and credits StickerDollars to user
 */
export class ValidatePurchaseUseCase {
  constructor({
    purchaseRepository,
    transactionRepository,
    balanceRepository,
    paymentProviderService,
    fraudDetectionService,
    planService
  }) {
    this.purchaseRepository = purchaseRepository;
    this.transactionRepository = transactionRepository;
    this.balanceRepository = balanceRepository;
    this.paymentProviderService = paymentProviderService;
    this.fraudDetectionService = fraudDetectionService;
    this.planService = planService;
  }
  
  /**
   * Execute purchase validation
   * @param {Object} input - Validation input
   * @param {string} input.userId - User identifier
   * @param {string} input.productId - Product ID
   * @param {string} input.purchaseToken - Store purchase token
   * @param {string} input.provider - 'GOOGLE_PLAY' or 'APPLE_APP_STORE'
   * @returns {Object} Validation result
   */
  async execute({ userId, productId, purchaseToken, provider }) {
    // 1. Validate product exists and get sticker amount
    const stickerAmount = this.planService.getStickerCount(productId);
    if (!stickerAmount) {
      throw new Error('Invalid product ID');
    }
    
    // 2. Check for duplicate transaction
    const existingTransaction = await this.transactionRepository
      .findByProviderTransactionId(purchaseToken);
    
    if (existingTransaction) {
      // Return existing balance without adding again
      const balance = await this.balanceRepository.findByUserId(userId);
      return {
        success: true,
        isDuplicate: true,
        transactionId: existingTransaction.id,
        amount: stickerAmount,
        newBalance: balance?.stickerDollars || 0,
        message: 'Purchase already processed'
      };
    }
    
    // 3. Fraud detection
    const fraudAnalysis = await this.fraudDetectionService.analyze({
      userId,
      productId,
      purchaseToken,
      provider
    });
    
    if (fraudAnalysis.isFraudulent) {
      throw new Error('Purchase flagged as fraudulent');
    }
    
    // 4. Validate with store provider
    const validationResult = await this.paymentProviderService.validatePurchase({
      productId,
      purchaseToken,
      provider
    });
    
    if (!validationResult.valid) {
      throw new Error(validationResult.error || 'Purchase validation failed');
    }
    
    // 5. Get or create user balance
    let balance = await this.balanceRepository.findByUserId(userId);
    if (!balance) {
      balance = await this.balanceRepository.createForUser(userId);
    }
    
    // 6. Add StickerDollars
    const newBalance = balance.add(stickerAmount);
    await this.balanceRepository.save(balance);
    
    // 7. Create transaction record
    const transaction = Transaction.createPurchase({
      userId,
      amount: stickerAmount,
      productId,
      provider,
      providerTransactionId: purchaseToken,
      balanceAfter: newBalance,
      metadata: {
        fraudFlags: fraudAnalysis.flags,
        riskScore: fraudAnalysis.riskScore
      }
    });
    await this.transactionRepository.save(transaction);
    
    // 8. Create purchase record
    const purchase = Purchase.create({
      userId,
      productId,
      purchaseToken,
      provider,
      stickerAmount
    });
    purchase.verify(transaction.id, fraudAnalysis.flags, fraudAnalysis.riskScore);
    await this.purchaseRepository.save(purchase);
    
    // 9. Return result
    return {
      success: true,
      isDuplicate: false,
      transactionId: transaction.id,
      amount: stickerAmount,
      newBalance,
      fraudFlags: fraudAnalysis.flags,
      riskScore: fraudAnalysis.riskScore
    };
  }
}
