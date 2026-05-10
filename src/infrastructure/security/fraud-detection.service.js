/**
 * Fraud Detection Service
 * Analyzes purchases for suspicious patterns
 */
export class FraudDetectionService {
  constructor() {
    this.suspiciousPatterns = new Set();   // token-level: repeated token detection
    this.userAttempts = new Map();          // user-level: rate limiting per user
  }
  
  /**
   * Analyze purchase for fraud
   * @param {Object} params
   * @param {string} params.userId
   * @param {string} params.productId
   * @param {string} params.purchaseToken
   * @param {string} params.provider
   * @returns {Object} Analysis result
   */
  async analyze({ userId, productId, purchaseToken, provider }) {
    const flags = [];
    let riskScore = 0;
    
    // Check 1: Token format validation
    if (!this.isValidTokenFormat(purchaseToken, provider)) {
      flags.push('INVALID_TOKEN_FORMAT');
      riskScore += 50;
    }
    
    // Check 2: Rapid repeated attempts (same token)
    if (this.suspiciousPatterns.has(purchaseToken)) {
      flags.push('REPEATED_TOKEN');
      riskScore += 30;
    } else {
      this.suspiciousPatterns.add(purchaseToken);
      // Clear after 1 hour
      setTimeout(() => this.suspiciousPatterns.delete(purchaseToken), 3600000);
    }
    
    // Check 3: Rate limiting per user
    const userKey = `user:${userId}`;
    const userAttempts = this.userAttempts.get(userKey) || 0;
    if (userAttempts > 10) {
      flags.push('RATE_LIMIT_EXCEEDED');
      riskScore += 40;
    }
    this.userAttempts.set(userKey, userAttempts + 1);
    
    // Determine if fraudulent (risk score > 70 is considered fraudulent)
    const isFraudulent = riskScore >= 70;
    
    return {
      isFraudulent,
      flags,
      riskScore
    };
  }
  
  isValidTokenFormat(token, provider) {
    if (!token || token.length < 10) {
      return false;
    }
    
    if (provider === 'GOOGLE_PLAY') {
      // Google Play tokens are typically alphanumeric with dots
      return /^[a-zA-Z0-9._-]+$/.test(token);
    }
    
    if (provider === 'APPLE_APP_STORE') {
      // Apple receipts are base64
      return /^[A-Za-z0-9+/=]+$/.test(token);
    }
    
    return true;
  }
}
