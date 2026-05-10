import { JsonUserRepository } from '../infrastructure/persistence/json/json-user.repository.js';
import { JsonBalanceRepository } from '../infrastructure/persistence/json/json-balance.repository.js';
import { JsonTransactionRepository } from '../infrastructure/persistence/json/json-transaction.repository.js';
import { JsonPurchaseRepository } from '../infrastructure/persistence/json/json-purchase.repository.js';

import { JwtService } from '../infrastructure/auth/jwt.service.js';
import { GoogleAuthService } from '../infrastructure/auth/google-auth.service.js';
import { PaymentProviderService } from '../infrastructure/payment/payment-provider.service.js';
import { FraudDetectionService } from '../infrastructure/security/fraud-detection.service.js';
import { PlanService } from '../application/services/plan.service.js';

import { AuthenticateGoogleUseCase } from '../application/use-cases/auth/authenticate-google.use-case.js';
import { ValidatePurchaseUseCase } from '../application/use-cases/purchase/validate-purchase.use-case.js';
import { GetBalanceUseCase } from '../application/use-cases/balance/get-balance.use-case.js';
import { SpendBalanceUseCase } from '../application/use-cases/balance/spend-balance.use-case.js';
import { GetTransactionHistoryUseCase } from '../application/use-cases/balance/get-transaction-history.use-case.js';

import { env } from './env.js';

/**
 * Dependency Injection Container
 * Manages all dependencies following Clean Architecture
 */
export class Container {
  constructor() {
    this.repositories = {};
    this.services = {};
    this.useCases = {};
    this.initialized = false;
  }
  
  /**
   * Initialize all dependencies
   */
  async initialize() {
    if (this.initialized) return;
    
    // Repositories (Infrastructure)
    this.repositories.user = new JsonUserRepository(env.DATA_DIR);
    this.repositories.balance = new JsonBalanceRepository(env.DATA_DIR);
    this.repositories.transaction = new JsonTransactionRepository(env.DATA_DIR);
    this.repositories.purchase = new JsonPurchaseRepository(env.DATA_DIR);
    
    // Services (Infrastructure)
    this.services.jwt = new JwtService();
    this.services.googleAuth = new GoogleAuthService();
    this.services.paymentProvider = new PaymentProviderService();
    this.services.fraudDetection = new FraudDetectionService();
    this.services.plan = new PlanService();
    
    // Use Cases (Application)
    this.useCases.authenticateGoogle = new AuthenticateGoogleUseCase({
      userRepository: this.repositories.user,
      balanceRepository: this.repositories.balance,
      googleAuthService: this.services.googleAuth,
      jwtService: this.services.jwt
    });
    
    this.useCases.validatePurchase = new ValidatePurchaseUseCase({
      purchaseRepository: this.repositories.purchase,
      transactionRepository: this.repositories.transaction,
      balanceRepository: this.repositories.balance,
      paymentProviderService: this.services.paymentProvider,
      fraudDetectionService: this.services.fraudDetection,
      planService: this.services.plan
    });
    
    this.useCases.getBalance = new GetBalanceUseCase({
      balanceRepository: this.repositories.balance
    });
    
    this.useCases.spendBalance = new SpendBalanceUseCase({
      balanceRepository: this.repositories.balance,
      transactionRepository: this.repositories.transaction
    });
    
    this.useCases.getTransactionHistory = new GetTransactionHistoryUseCase({
      transactionRepository: this.repositories.transaction
    });
    
    this.initialized = true;
    console.log('✅ Dependency container initialized');
  }
  
  // Getters for clean access
  get repositories() {
    return this._repositories;
  }
  
  set repositories(value) {
    this._repositories = value;
  }
  
  get services() {
    return this._services;
  }
  
  set services(value) {
    this._services = value;
  }
  
  get useCases() {
    return this._useCases;
  }
  
  set useCases(value) {
    this._useCases = value;
  }
}

// Global container instance
export const container = new Container();
