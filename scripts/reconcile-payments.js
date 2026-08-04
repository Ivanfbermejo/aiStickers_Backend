import { createRepositories } from '../src/infrastructure/persistence/factory.js';
import { PlanService } from '../src/application/services/plan.service.js';
import { PaymentProviderService } from '../src/infrastructure/payment/payment-provider.service.js';
import { FraudDetectionService } from '../src/infrastructure/security/fraud-detection.service.js';
import { PaymentReconcilerService } from '../src/application/services/payment-reconciler.service.js';
import { env } from '../src/config/env.js';
import { disconnectPrisma } from '../src/infrastructure/persistence/prisma/client.js';

function parseArgs(argv) {
  const args = argv.slice(2);
  const result = { dryRun: false, batchSize: 100, maxAttempts: 10 };
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--dry-run') {
      result.dryRun = true;
    } else if (arg === '--batch-size') {
      result.batchSize = Number(args[++i]);
    } else if (arg === '--max-attempts') {
      result.maxAttempts = Number(args[++i]);
    } else if (arg === '--help' || arg === '-h') {
      printUsage();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return result;
}

function printUsage() {
  console.log('Usage: node scripts/reconcile-payments.js [--dry-run] [--batch-size N] [--max-attempts N]');
  console.log('');
  console.log('Options:');
  console.log('  --dry-run          Report only, do not credit or reject purchases');
  console.log('  --batch-size N     Process at most N purchases per run (default 100)');
  console.log('  --max-attempts N   Stop retrying a purchase after N attempts (default 10)');
}

async function main() {
  if (!env.DATABASE_URL) {
    throw new Error('DATABASE_URL is required for payment reconciliation');
  }

  const { dryRun, batchSize, maxAttempts } = parseArgs(process.argv);

  const repositories = await createRepositories();
  const paymentProviderService = new PaymentProviderService();
  const planService = new PlanService();

  const reconciler = new PaymentReconcilerService({
    purchaseRepository: repositories.purchase,
    balanceRepository: repositories.balance,
    transactionRepository: repositories.transaction,
    paymentProviderService,
    planService,
    unitOfWork: repositories.unitOfWork,
    batchSize,
    maxAttempts
  });

  const summary = await reconciler.reconcile({ dryRun });

  console.log(JSON.stringify(summary, null, 2));

  await disconnectPrisma();
}

main().catch(async (err) => {
  console.error('Reconciliation failed:', err.message);
  await disconnectPrisma().catch(() => {});
  process.exit(1);
});
