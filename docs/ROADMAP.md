# aiStickers Backend - Roadmap

> Hoja de ruta priorizada para mejoras del backend. Ordenado por criticidad: **CRÍTICO** → **ALTO** → **MEDIO** → **BAJO**

---

## 🔴 PRIORIDAD CRÍTICA (Inseguro / No funcional sin esto)

### 1. Seguridad: Eliminar JWT_SECRET fallback
**Estado:** ❌ Inseguro  
**Impacto:** Cualquiera puede generar tokens válidos si no hay env var  
**Archivo:** `src/config/env.js`

```javascript
// ❌ ANTES (inseguro)
JWT_SECRET: process.env.JWT_SECRET || 'your-secret-key'

// ✅ DESPUÉS (seguro)
JWT_SECRET: (() => {
  const secret = process.env.JWT_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error('JWT_SECRET environment variable required and must be at least 32 characters');
  }
  return secret;
})()
```

**Tiempo estimado:** 10 minutos  
**Bloquea deploy a producción:** SÍ

---

### 2. Rate Limiting Global
**Estado:** ❌ Ausente  
**Impacto:** Vulnerable a DDoS y brute force  
**Archivo:** Nuevo middleware

```javascript
import rateLimit from 'express-rate-limit';

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutos
  max: 100, // 100 requests por ventana
  message: {
    error: 'Too many requests',
    retryAfter: '15 minutes'
  }
});

app.use('/api/', limiter);
```

**Tiempo estimado:** 30 minutos  
**Dependencias:** `express-rate-limit`

---

### 3. Validación Real de Google Play
**Estado:** ⚠️ Test mode (acepta todas las compras)  
**Impacto:** Compras fraudulentas pasan al sistema  
**Archivo:** `src/infrastructure/payment/google-play.service.js`

```javascript
// ❌ ANTES
if (this.isTestMode) {
  return { valid: true }; // Cualquiera puede comprar
}

// ✅ DESPUÉS
// Implementar validación real con Google Play API
// Usar service account credentials
```

**Requisitos:**
- [ ] Crear Google Play Service Account
- [ ] Configurar `GOOGLE_PLAY_SERVICE_ACCOUNT` env var
- [ ] Implementar `androidpublisher.purchases.products.get()`

**Tiempo estimado:** 2-4 horas  
**Bloquea monetización real:** SÍ

---

## 🟠 PRIORIDAD ALTA (Escalabilidad / Performance)

### 4. Migrar persistencia de JSON a PostgreSQL
**Estado:** ⚠️ JSON files (no escala)  
**Impacto:** Race conditions, corrupción de datos, no escala horizontal  
**Archivos:** Todos los `json-*.repository.js`

**Plan de migración:**

```
Semana 1:
├── Instalar Prisma
├── Crear schema.prisma
├── Migrar entidades:
│   ├── User
│   ├── Balance
│   ├── Transaction
│   └── Purchase
└── Crear scripts de migración de datos

Semana 2:
├── Implementar PostgresRepository (base)
├── Migrar cada repositorio:
│   ├── PostgresUserRepository
│   ├── PostgresBalanceRepository
│   ├── PostgresTransactionRepository
│   └── PostgresPurchaseRepository
└── Testing
```

**Schema Prisma sugerido:**

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

model User {
  id        String   @id
  email     String   @unique
  name      String
  googleId  String?  @unique
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  
  balance      Balance?
  transactions Transaction[]
  purchases    Purchase[]
}

model Balance {
  id            String @id @default(uuid())
  userId        String @unique
  stickerDollars Int    @default(0)
  totalPurchased Int   @default(0)
  totalSpent    Int    @default(0)
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt
  
  user User @relation(fields: [userId], references: [id])
}

model Transaction {
  id                   String   @id @default(uuid())
  userId               String
  type                 String   // PURCHASE | SPEND
  amount               Int
  productId            String?
  provider             String?  // GOOGLE_PLAY | APPLE_APP_STORE | SYSTEM
  providerTransactionId String? @unique
  balanceAfter         Int
  metadata             Json?
  createdAt            DateTime @default(now())
  
  user User @relation(fields: [userId], references: [id])
}

model Purchase {
  id                   String   @id @default(uuid())
  userId               String
  productId            String
  purchaseToken        String   @unique
  provider             String
  status               String   // PENDING | VERIFIED | FAILED
  stickerAmount        Int
  transactionId        String?
  fraudFlags           String[]
  riskScore            Int      @default(0)
  createdAt            DateTime @default(now())
  verifiedAt           DateTime?
  
  user User @relation(fields: [userId], references: [id])
}
```

**Tiempo estimado:** 2-3 semanas  
**Dependencias:** Prisma, PostgreSQL

---

### 5. Caché con Redis
**Estado:** ❌ In-memory Map (se pierde en restart)  
**Impacto:** Performance degradada, datos inconsistentes entre instancias  

**Casos de uso:**
1. **Balances hot**: Cachear balances de usuarios activos
2. **Token blacklist**: Revocación de tokens JWT
3. **Rate limiting**: Contadores distribuidos
4. **Sesiones**: Datos de sesión temporal

```javascript
// src/infrastructure/cache/redis.service.js
import Redis from 'ioredis';

export class RedisCache {
  constructor() {
    this.client = new Redis({
      host: process.env.REDIS_HOST || 'localhost',
      port: process.env.REDIS_PORT || 6379
    });
  }
  
  async getBalance(userId) {
    const cached = await this.client.get(`balance:${userId}`);
    return cached ? JSON.parse(cached) : null;
  }
  
  async setBalance(userId, balance, ttl = 300) { // 5 minutos
    await this.client.setex(
      `balance:${userId}`,
      ttl,
      JSON.stringify(balance)
    );
  }
  
  async blacklistToken(token, expiresIn) {
    const decoded = jwt.decode(token);
    const ttl = decoded.exp - Math.floor(Date.now() / 1000);
    await this.client.setex(`blacklist:${token}`, ttl, 'true');
  }
}
```

**Tiempo estimado:** 1 semana  
**Dependencias:** Redis, ioredis

---

### 6. Cola de Procesamiento Asíncrono
**Estado:** ❌ Procesamiento síncrono  
**Impacto:** Requests lentos, timeouts en validación de compras  

**Flujo actual (síncrono):**
```
Request → Validar HMAC → Validar JWT → Validar con Google → 
Actualizar balance → Guardar transacción → Response
[Total: 2-5 segundos]
```

**Flujo deseado (async):**
```
Request → Validar HMAC → Validar JWT → Encolar job → Response inmediato
[Total: 200ms]

Background:
Job → Validar con Google → Actualizar balance → Notificar cliente (WebSocket)
```

**Implementación con Bull:**

```javascript
// src/infrastructure/queue/purchase.queue.js
import Queue from 'bull';

export class PurchaseQueue {
  constructor() {
    this.queue = new Queue('purchase-validation', {
      redis: { host: 'localhost', port: 6379 }
    });
    
    this.queue.process(async (job) => {
      const { userId, productId, purchaseToken, provider } = job.data;
      return await validatePurchaseUseCase.execute({
        userId, productId, purchaseToken, provider
      });
    });
  }
  
  async add(data) {
    return this.queue.add(data, {
      attempts: 3,
      backoff: { type: 'exponential', delay: 2000 }
    });
  }
}
```

**Tiempo estimado:** 1-2 semanas  
**Dependencias:** Redis, Bull

---

## 🟡 PRIORIDAD MEDIA (Calidad / DX)

### 7. Tests Unitarios y de Integración
**Estado:** ❌ 0% coverage  
**Impacto:** Regresiones, miedo a refactorizar  

**Estrategia:**

```
tests/
├── unit/
│   ├── domain/
│   │   ├── balance.entity.test.js
│   │   ├── transaction.entity.test.js
│   │   └── user.entity.test.js
│   └── application/
│       ├── validate-purchase.use-case.test.js
│       └── get-balance.use-case.test.js
├── integration/
│   ├── auth.controller.test.js
│   ├── payment.controller.test.js
│   └── balance.controller.test.js
└── e2e/
    └── purchase-flow.test.js
```

**Ejemplo de test unitario:**

```javascript
// tests/unit/domain/balance.entity.test.js
describe('Balance Entity', () => {
  test('should add sticker dollars', () => {
    const balance = new Balance({ userId: 'user@email.com', stickerDollars: 10 });
    const newBalance = balance.add(5);
    expect(newBalance).toBe(15);
    expect(balance.totalPurchased).toBe(15);
  });
  
  test('should throw on insufficient balance', () => {
    const balance = new Balance({ userId: 'user@email.com', stickerDollars: 5 });
    expect(() => balance.spend(10)).toThrow('Insufficient balance');
  });
});
```

**Tiempo estimado:** 2-3 semanas  
**Dependencias:** Jest, Supertest (para integration)

---

### 8. Logging Estructurado
**Estado:** ⚠️ console.log dispersos  
**Impacto:** Difícil debugging, sin trazabilidad  

**Solución:** Winston + correlación de requests

```javascript
// src/infrastructure/logging/logger.js
import winston from 'winston';

export const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  defaultMeta: { service: 'aiStickers-backend' },
  transports: [
    new winston.transports.Console(),
    new winston.transports.File({ filename: 'logs/error.log', level: 'error' }),
    new winston.transports.File({ filename: 'logs/combined.log' })
  ]
});

// Uso en controllers:
logger.info('Purchase validated', {
  userId: req.user.sub,
  transactionId: result.transactionId,
  amount: result.amount,
  requestId: req.id // Correlación
});
```

**Tiempo estimado:** 3-4 días  
**Dependencias:** Winston

---

### 9. Manejo de Errores de Dominio
**Estado:** ⚠️ Usa Error genérico  
**Impacto:** Cliente no puede diferenciar errores  

**Crear excepciones custom:**

```javascript
// src/domain/errors/domain.error.js
export class DomainError extends Error {
  constructor(message, code, statusCode = 400) {
    super(message);
    this.code = code;
    this.statusCode = statusCode;
  }
}

export class InsufficientBalanceError extends DomainError {
  constructor(balance, required) {
    super(
      `Insufficient balance: ${balance} < ${required}`,
      'INSUFFICIENT_BALANCE',
      400
    );
    this.balance = balance;
    this.required = required;
  }
}

export class DuplicateTransactionError extends DomainError {
  constructor(transactionId) {
    super(
      'Transaction already processed',
      'DUPLICATE_TRANSACTION',
      409
    );
    this.transactionId = transactionId;
  }
}

export class FraudDetectedError extends DomainError {
  constructor(flags, riskScore) {
    super(
      'Purchase flagged as fraudulent',
      'FRAUD_DETECTED',
      403
    );
    this.flags = flags;
    this.riskScore = riskScore;
  }
}
```

**Middleware de manejo:**

```javascript
// src/infrastructure/web/middleware/error.middleware.js
export function errorHandler(err, req, res, next) {
  if (err instanceof DomainError) {
    return res.status(err.statusCode).json({
      error: err.code,
      message: err.message,
      details: err instanceof InsufficientBalanceError ? {
        currentBalance: err.balance,
        requiredAmount: err.required
      } : undefined
    });
  }
  
  // Log unexpected errors
  logger.error('Unexpected error', {
    error: err.message,
    stack: err.stack,
    requestId: req.id
  });
  
  res.status(500).json({
    error: 'INTERNAL_ERROR',
    message: 'An unexpected error occurred'
  });
}
```

**Tiempo estimado:** 1 semana

---

## 🟢 PRIORIDAD BAJA (Nice to have)

### 10. WebSocket para Notificaciones Real-time
**Estado:** ❌ No implementado  
**Uso:** Notificar al cliente cuando una compra pendiente se valida  

```javascript
// src/infrastructure/web/websocket/purchase.socket.js
import { Server } from 'socket.io';

export class PurchaseWebSocket {
  constructor(httpServer) {
    this.io = new Server(httpServer);
    
    this.io.on('connection', (socket) => {
      const userId = socket.handshake.auth.userId;
      socket.join(`user:${userId}`);
    });
  }
  
  notifyPurchaseCompleted(userId, data) {
    this.io.to(`user:${userId}`).emit('purchase:completed', data);
  }
}
```

**Tiempo estimado:** 3-4 días  
**Dependencias:** Socket.io

---

### 11. Documentación API con OpenAPI/Swagger
**Estado:** ⚠️ Solo Markdown  
**Uso:** Interactive API docs, generación de client SDKs  

**Tiempo estimado:** 2-3 días  
**Dependencias:** swagger-jsdoc, swagger-ui-express

---

### 12. CI/CD Pipeline
**Estado:** ❌ Manual deploy  
**Uso:** Tests automáticos, deploy automático  

**GitHub Actions workflow:**

```yaml
name: CI/CD
on: [push, pull_request]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
      - run: npm ci
      - run: npm test
      - run: npm run test:integration
  
  deploy:
    needs: test
    if: github.ref == 'refs/heads/main'
    runs-on: ubuntu-latest
    steps:
      - name: Deploy to production
        run: |
          # Deploy script
```

**Tiempo estimado:** 2-3 días

---

### 13. Monitoreo y Alerting
**Estado:** ❌ Sin observabilidad  
**Herramientas:** Prometheus + Grafana, Sentry para errores  

**Métricas clave:**
- Request latency (p50, p95, p99)
- Error rate
- Balance update lag
- Purchase validation time
- Active users

**Tiempo estimado:** 1 semana  
**Dependencias:** prom-client, sentry

---

## 📅 Timeline Sugerido

### Sprint 1 (Semanas 1-2): **Seguridad Crítica** 🔴
- [ ] 1. Eliminar JWT_SECRET fallback
- [ ] 2. Rate limiting global
- [ ] 3. Validación real de Google Play
- [ ] 4. Logging estructurado (básico)

**Bloqueos eliminados:** Deploy a producción seguro

### Sprint 2 (Semanas 3-4): **Persistencia Real** 🟠
- [ ] 4. Migrar a PostgreSQL
- [ ] 7. Tests unitarios (core entities)
- [ ] 9. Manejo de errores de dominio

**Resultado:** Base sólida, datos confiables

### Sprint 3 (Semanas 5-6): **Performance & Escalabilidad** 🟠
- [ ] 5. Redis cache
- [ ] 6. Cola de procesamiento async
- [ ] 10. WebSocket (opcional)

**Resultado:** Capacidad para 10k+ usuarios

### Sprint 4 (Semanas 7-8): **Calidad & DX** 🟡
- [ ] 7. Tests de integración completos
- [ ] 11. Swagger/OpenAPI
- [ ] 12. CI/CD pipeline
- [ ] 13. Monitoreo básico

**Resultado:** Proyecto enterprise-ready

---

## 💰 Costes Estimados (AWS)

| Infraestructura | Instancia | Coste/mes |
|-----------------|-----------|-----------|
| EC2 (backend) | t3.small | ~$15 |
| RDS PostgreSQL | db.t3.micro | ~$15 |
| ElastiCache Redis | cache.t3.micro | ~$15 |
| S3 (assets) | - | ~$5 |
| CloudWatch | - | ~$5 |
| **Total** | | **~$55/mes** |

*Para < 1000 usuarios activos. Escalar horizontalmente después.

---

## 🎯 Métricas de Éxito

| Métrica | Antes | Después (Target) |
|---------|-------|------------------|
| Test coverage | 0% | > 80% |
| Request p95 latency | 2000ms | < 500ms |
| Error rate | ?% | < 0.1% |
| Deploy frequency | Manual | Daily |
| Mean time to recovery | Horas | < 30 min |

---

**Última actualización:** 2024-01-XX  
**Próxima revisión:** Después de completar Sprint 1
