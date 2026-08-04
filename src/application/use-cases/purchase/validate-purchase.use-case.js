import { Purchase } from '../../../domain/entities/purchase.entity.js';
import { Transaction } from '../../../domain/entities/transaction.entity.js';

/**
 * Validate Purchase Use Case
 * Orchestrates the validation of a store purchase (Google Play/Apple)
 * and credits StickerDollars to the user atomically.
 */
export class ValidatePurchaseUseCase {
  constructor({
    purchaseRepository,
    transactionRepository,
    balanceRepository,
    paymentProviderService,
    fraudDetectionService,
    planService,
    unitOfWork
  }) {
    this.purchaseRepository = purchaseRepository;
    this.transactionRepository = transactionRepository;
    this.balanceRepository = balanceRepository;
    this.paymentProviderService = paymentProviderService;
    this.fraudDetectionService = fraudDetectionService;
    this.planService = planService;
    this.unitOfWork = unitOfWork;
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
    const stickerAmount = this.planService.getStickerCount(productId);
    if (!stickerAmount) {
      throw new Error('Invalid product ID');
    }

    const fraudAnalysis = await this.fraudDetectionService.analyze({
      userId,
      productId,
      purchaseToken,
      provider
    });

    if (fraudAnalysis.isFraudulent) {
      throw new Error('Purchase flagged as fraudulent');
    }

    const validationResult = await this.paymentProviderService.validatePurchase({
      productId,
      purchaseToken,
      provider
    });

    if (validationResult.pending) {
      return this.unitOfWork.run(async (repos) => {
        const existing = await repos.purchase.findByToken(purchaseToken);
        if (existing) {
          const balance = await repos.balance.findByUserId(userId);
          return {
            success: false,
            pending: true,
            isDuplicate: true,
            transactionId: existing.transactionId,
            amount: stickerAmount,
            newBalance: balance?.stickerDollars || 0,
            message: 'Purchase already processed and still pending'
          };
        }

        const transaction = Transaction.createPurchase({
          userId,
          amount: stickerAmount,
          productId,
          provider,
          providerTransactionId: purchaseToken,
          balanceAfter: null,
          metadata: {
            status: 'PENDING',
            fraudFlags: fraudAnalysis.flags,
            riskScore: fraudAnalysis.riskScore
          }
        });
        await repos.transaction.save(transaction);

        const purchase = Purchase.create({
          userId,
          productId,
          purchaseToken,
          provider,
          stickerAmount
        });
        purchase.markPending();
        await repos.purchase.save(purchase);

        const balance = await repos.balance.findByUserId(userId);
        return {
          success: false,
          pending: true,
          transactionId: transaction.id,
          amount: stickerAmount,
          newBalance: balance?.stickerDollars || 0,
          message: 'Purchase is being verified. Balance will update once confirmed.'
        };
      });
    }

    if (!validationResult.valid) {
      return this.unitOfWork.run(async (repos) => {
        const existing = await repos.purchase.findByToken(purchaseToken);
        if (existing) {
          const balance = await repos.balance.findByUserId(userId);
          return {
            success: false,
            isDuplicate: true,
            transactionId: existing.transactionId,
            amount: stickerAmount,
            newBalance: balance?.stickerDollars || 0
          };
        }

        const purchase = Purchase.create({
          userId,
          productId,
          purchaseToken,
          provider,
          stickerAmount,
          orderId: validationResult.orderId ?? null
        });
        purchase.markRejected();
        await repos.purchase.save(purchase);

        throw new Error(validationResult.error || 'Purchase validation failed');
      });
    }

    try {
      return await this.unitOfWork.run(async (repos) => {
        const existing = await repos.purchase.findByToken(purchaseToken);
        if (existing) {
          if (existing.status === 'CREDITED') {
            const balance = await repos.balance.findByUserId(userId);
            return {
              success: true,
              isDuplicate: true,
              transactionId: existing.transactionId,
              amount: stickerAmount,
              newBalance: balance?.stickerDollars || 0,
              fraudFlags: fraudAnalysis.flags,
              riskScore: fraudAnalysis.riskScore
            };
          }
          throw new Error(`Purchase already processed with status ${existing.status}`);
        }

        let balance = await repos.balance.findByUserId(userId);
        if (!balance) {
          balance = await repos.balance.createForUser(userId);
        }

        const newBalance = balance.add(stickerAmount);
        await repos.balance.save(balance);

        const transaction = Transaction.createPurchase({
          userId,
          amount: stickerAmount,
          productId,
          provider,
          providerTransactionId: purchaseToken,
          balanceAfter: newBalance,
          metadata: {
            status: 'CREDITED',
            fraudFlags: fraudAnalysis.flags,
            riskScore: fraudAnalysis.riskScore
          }
        });
        await repos.transaction.save(transaction);

        const purchase = Purchase.create({
          userId,
          productId,
          purchaseToken,
          provider,
          stickerAmount,
          orderId: validationResult.orderId ?? null
        });
        purchase.credit(
          transaction.id,
          fraudAnalysis.flags,
          fraudAnalysis.riskScore,
          validationResult.providerResponse ?? null
        );
        await repos.purchase.save(purchase);

        return {
          success: true,
          isDuplicate: false,
          transactionId: transaction.id,
          amount: stickerAmount,
          newBalance,
          fraudFlags: fraudAnalysis.flags,
          riskScore: fraudAnalysis.riskScore
        };
      });
    } catch (error) {
      if (error.code === 'P2002') {
        const existing = await this.purchaseRepository.findByToken(purchaseToken);
        if (existing && existing.status === 'CREDITED') {
          const balance = await this.balanceRepository.findByUserId(userId);
          return {
            success: true,
            isDuplicate: true,
            transactionId: existing.transactionId,
            amount: stickerAmount,
            newBalance: balance?.stickerDollars || 0,
            fraudFlags: fraudAnalysis.flags,
            riskScore: fraudAnalysis.riskScore
          };
        }
      }
      throw error;
    }
  }
}
