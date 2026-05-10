# aiStickers Backend - Clean Architecture

## Overview

Backend implementado siguiendo **Clean Architecture** (Arquitectura Limpia) con las siguientes capas:

```
┌─────────────────────────────────────────┐
│         Infrastructure Layer            │
│  (Web, Persistence, External Services)  │
├─────────────────────────────────────────┤
│         Application Layer               │
│  (Use Cases, Application Services)    │
├─────────────────────────────────────────┤
│         Domain Layer                    │
│  (Entities, Repository Interfaces)      │
└─────────────────────────────────────────┘
```

## Dependency Rule

Las dependencias apuntan SIEMPRE hacia adentro (hacia el Dominio):
- **Infrastructure** depende de **Application** y **Domain**
- **Application** depende de **Domain**
- **Domain** NO depende de ninguna otra capa

## Layer Details

### 1. Domain Layer (`src/domain/`)

Contiene la lógica de negocio pura, independiente de frameworks y tecnologías.

#### Entities (`src/domain/entities/`)

Entidades de negocio con reglas y comportamiento:

| Entity | Description | Key Methods |
|--------|-------------|-------------|
| `User` | Usuario de la aplicación | `validate()`, `fromGoogleProfile()` |
| `Balance` | Balance de StickerDollars | `add()`, `spend()`, `hasEnough()` |
| `Transaction` | Registro de compra/gasto | `createPurchase()`, `createSpend()` |
| `Purchase` | Compra validada de store | `verify()`, `isVerified()` |

#### Repository Interfaces (`src/domain/repositories/`)

Contratos que definen cómo se accede a datos. Las implementaciones concretas están en Infrastructure.

- `IUserRepository`
- `IBalanceRepository`
- `ITransactionRepository`
- `IPurchaseRepository`

### 2. Application Layer (`src/application/`)

Orquesta los casos de uso de la aplicación.

#### Use Cases (`src/application/use-cases/`)

Cada caso de uso representa una operación de negocio:

| Use Case | Description | Dependencies |
|----------|-------------|--------------|
| `AuthenticateGoogleUseCase` | Autenticación con Google | UserRepository, GoogleAuthService, JwtService |
| `ValidatePurchaseUseCase` | Validar compra de store | Repositories, PaymentProviderService, FraudDetectionService |
| `GetBalanceUseCase` | Obtener balance de usuario | BalanceRepository |
| `SpendBalanceUseCase` | Gastar StickerDollars | BalanceRepository, TransactionRepository |
| `GetTransactionHistoryUseCase` | Historial de transacciones | TransactionRepository |

#### Application Services (`src/application/services/`)

Servicios de aplicación que no son casos de uso específicos:

- `PlanService`: Mapeo de product IDs a cantidades de stickers

### 3. Infrastructure Layer (`src/infrastructure/`)

Implementaciones concretas de interfaces del dominio y adaptadores externos.

#### Persistence (`src/infrastructure/persistence/`)

Implementaciones de repositorios usando JSON files:

| Repository | File | Description |
|------------|------|-------------|
| `JsonUserRepository` | `users.json` | Persistencia de usuarios |
| `JsonBalanceRepository` | `balances.json` | Persistencia de balances |
| `JsonTransactionRepository` | `transactions.json` | Persistencia de transacciones |
| `JsonPurchaseRepository` | `purchases.json` | Persistencia de compras |

#### Auth Services (`src/infrastructure/auth/`)

- `JwtService`: Generación y verificación de tokens JWT
- `GoogleAuthService`: Verificación de tokens de Google

#### Payment (`src/infrastructure/payment/`)

- `PaymentProviderService`: Interfaz unificada para proveedores de pago
- `GooglePlayPaymentService`: Validación con Google Play API

#### Security (`src/infrastructure/security/`)

- `FraudDetectionService`: Detección de patrones fraudulentos

#### Web Layer (`src/infrastructure/web/`)

**Controllers**: Manejan HTTP requests/responses
- `AuthController`: Endpoints de autenticación
- `PaymentController`: Endpoints de validación de pagos
- `BalanceController`: Endpoints de balance y transacciones
- `ConfigController`: Configuración pública
- `PlanController`: Endpoints de planes de compra

**Middleware**:
- `HmacMiddleware`: Verificación de firma HMAC de la app (usa :authcore del frontend)
  - Headers: `X-App-Id`, `X-App-Timestamp`, `X-App-Nonce`, `X-App-Signature`
  - Canonical string: `timestamp.nonce.method.path.bodyHash`
- `AuthMiddleware`: Verificación de tokens JWT

## Configuration (`src/config/`)

- `env.js`: Variables de entorno y validación
- `container.js`: Dependency Injection Container

## Security Architecture

### Double Factor Authentication

Todos los endpoints (excepto health check) requieren **dos factores**:

1. **HMAC Signature** (`X-App-Id`, `X-App-Timestamp`, `X-App-Nonce`, `X-App-Signature`)
   - Autentica que la petición viene de la app legítima (usa :authcore del frontend)
   - Previene requests desde apps no autorizadas
   - Formato: `timestamp.nonce.method.path.bodyHash` firmado con HMAC-SHA256

2. **JWT Token** (`Authorization: Bearer <token>`)
   - **App Token**: Para endpoints públicos (config, planes)
   - **User Token**: Para operaciones de usuario (compras, balance)

### Token Types

```javascript
// App Token (sin usuario)
{
  sub: "app",
  type: "app",
  scope: ["stickers"]
}

// User Token (con usuario autenticado)
{
  sub: "user@email.com",    // Email como ID principal
  email: "user@email.com",
  name: "User Name",
  googleId: "123456",
  type: "user",
  scope: ["stickers"]
}
```

### Endpoint Security Matrix

| Endpoint | HMAC | User JWT | Description |
|----------|------|----------|-------------|
| `GET /health` | ❌ | ❌ | Health check público |
| `POST /api/v1/auth/token` | ✅ | ❌ | Generar App Token |
| `POST /api/v1/auth/google` | ✅ | ❌ | Google Sign-In |
| `GET /api/v1/config` | ✅ | ❌ | Config pública |
| `GET /api/v1/plans` | ✅ | ✅ | Listar planes |
| `POST /api/v1/payments/*` | ✅ | ✅ | Validar compras |
| `GET /api/v1/users/balance` | ✅ | ✅ | Ver balance |
| `POST /api/v1/users/balance/spend` | ✅ | ✅ | Gastar stickers |
| `GET /api/v1/users/balance/history` | ✅ | ✅ | Historial |

## Data Flow Example: Purchase Validation

```
┌─────────────┐     ┌─────────────────┐     ┌──────────────────┐
│   Client    │────▶│  HMAC Middleware │────▶│  Auth Middleware │
│  (App)      │     │  (verify app)    │     │  (verify user)   │
└─────────────┘     └─────────────────┘     └──────────────────┘
                                                       │
                                                       ▼
                                              ┌──────────────────┐
                                              │ PaymentController│
                                              │ (HTTP Handler)   │
                                              └──────────────────┘
                                                       │
                                                       ▼
                                              ┌──────────────────┐
                                              │ValidatePurchase  │
                                              │UseCase           │
                                              │(Business Logic)   │
                                              └──────────────────┘
                                                       │
              ┌──────────────────────────────────────────┼──────────┐
              │                                          │          │
              ▼                                          ▼          ▼
    ┌──────────────────┐      ┌──────────────────┐    ┌──────────────────┐
    │PaymentProvider     │      │FraudDetection    │    │Repositories      │
    │Service             │      │Service           │    │(JSON Files)      │
    │(Validate with      │      │(Check fraud)     │    │(Save data)       │
    │Google Play)        │      │                  │    │                  │
    └──────────────────┘      └──────────────────┘    └──────────────────┘
```

## File Structure

```
aiStickers_Backend/
├── index.js                      # Entry point
├── src/
│   ├── config/
│   │   ├── env.js               # Environment configuration
│   │   └── container.js         # DI Container
│   │
│   ├── domain/                  # BUSINESS LOGIC
│   │   ├── entities/
│   │   │   ├── user.entity.js
│   │   │   ├── balance.entity.js
│   │   │   ├── transaction.entity.js
│   │   │   └── purchase.entity.js
│   │   └── repositories/
│   │       ├── user.repository.js
│   │       ├── balance.repository.js
│   │       ├── transaction.repository.js
│   │       └── purchase.repository.js
│   │
│   ├── application/             # USE CASES
│   │   ├── use-cases/
│   │   │   ├── auth/
│   │   │   │   └── authenticate-google.use-case.js
│   │   │   ├── purchase/
│   │   │   │   └── validate-purchase.use-case.js
│   │   │   └── balance/
│   │   │       ├── get-balance.use-case.js
│   │   │       ├── spend-balance.use-case.js
│   │   │       └── get-transaction-history.use-case.js
│   │   └── services/
│   │       └── plan.service.js
│   │
│   └── infrastructure/          # IMPLEMENTATIONS
│       ├── persistence/
│       │   └── json/
│       │       ├── json-user.repository.js
│       │       ├── json-balance.repository.js
│       │       ├── json-transaction.repository.js
│       │       └── json-purchase.repository.js
│       ├── auth/
│       │   ├── jwt.service.js
│       │   └── google-auth.service.js
│       ├── payment/
│       │   ├── payment-provider.service.js
│       │   └── google-play.service.js
│       ├── security/
│       │   └── fraud-detection.service.js
│       └── web/
│           ├── middleware/
│           │   ├── hmac.middleware.js
│           │   └── auth.middleware.js
│           └── controllers/
│               ├── auth.controller.js
│               ├── payment.controller.js
│               ├── balance.controller.js
│               ├── config.controller.js
│               └── plan.controller.js
│
├── data/                        # JSON data files
│   ├── users.json
│   ├── balances.json
│   ├── transactions.json
│   └── purchases.json
│
└── docs/                        # Documentation
    ├── architecture.md          # This file
    ├── paymentCore-api.md     # API Documentation
    └── social-auth-api.md     # Auth API Documentation
```

## Key Principles Applied

### 1. Single Responsibility Principle (SRP)
Cada clase tiene una única razón para cambiar.

### 2. Open/Closed Principle (OCP)
Las entidades están abiertas para extensión pero cerradas para modificación.

### 3. Dependency Inversion Principle (DIP)
Las capas superiores dependen de abstracciones (interfaces), no de implementaciones concretas.

### 4. Separation of Concerns
- **Domain**: Solo lógica de negocio
- **Application**: Solo orquestación de casos de uso
- **Infrastructure**: Solo detalles técnicos

## Testing Strategy

### Unit Tests
Testear use cases con mocks de repositorios.

### Integration Tests
Testear endpoints completos con base de datos en memoria.

### E2E Tests
Testear flujos completos desde el cliente.

## Migration from Old Code

El código anterior (`index-old.js`) fue unificado en la arquitectura limpia:

| Old File | New Location |
|----------|--------------|
| `auth.controller.js` (old) | `src/infrastructure/web/controllers/auth.controller.js` |
| `paymentCore.controller.js` | `src/infrastructure/web/controllers/payment.controller.js` |
| `balance.simple.service.js` | `src/infrastructure/persistence/json/json-balance.repository.js` + `Balance` entity |
| `auth.service.js` | `src/infrastructure/auth/jwt.service.js` |
| `auth.middleware.js` | `src/infrastructure/web/middleware/auth.middleware.js` |

## Future Improvements

1. **Database**: Migrar de JSON a PostgreSQL/MongoDB
2. **Caching**: Implementar Redis para balances
3. **Queue**: Usar RabbitMQ/SQS para procesamiento asíncrono de compras
4. **Monitoring**: Añadir métricas con Prometheus/Grafana
5. **Tests**: Añadir tests unitarios e integración

## References

- [Clean Architecture by Robert C. Martin](https://blog.cleancoder.com/uncle-bob/2012/08/13/the-clean-architecture.html)
- [Dependency Injection in Node.js](https://nodejs.org/docs/latest/api/)
- [JWT Best Practices](https://tools.ietf.org/html/rfc8725)
