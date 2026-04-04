# PaymentCore API Documentation

## Overview

PaymentCore es un servicio completo para la gestión de pagos con detección de fraudes integrada. Soporta validación de compras de Google Play y Apple App Store, gestión de balances y análisis anti-fraude en tiempo real.

## Authentication

Todos los endpoints requieren autenticación JWT. Para obtener un token:

```bash
POST /auth/token
Headers:
  X-Client-ID: tu_client_id
  X-Signature: hmac_sha256_signature

Response:
{
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "expiresIn": "15m"
}
```

## Endpoints

### 1. Validación de Compras

#### Google Play
```bash
POST /api/v1/payments/validate/google-play
Authorization: Bearer <JWT>
Content-Type: application/json

{
  "purchaseToken": "google_play_purchase_token",
  "productId": "basic_pack_android",
  "expectedAmount": 4.99
}
```

#### Apple App Store
```bash
POST /api/v1/payments/validate/apple-app-store
Authorization: Bearer <JWT>
Content-Type: application/json

{
  "receiptData": "apple_receipt_data",
  "productId": "basic_pack_ios",
  "expectedAmount": 4.99
}
```

**Response exitoso:**
```json
{
  "success": true,
  "transactionId": "uuid-transaction-id",
  "amount": 4.99,
  "newBalance": 104.99,
  "fraudFlags": [],
  "riskScore": 0.1
}
```

**Response con fraude detectado:**
```json
{
  "success": false,
  "error": "High fraud risk detected",
  "fraudFlags": [
    {
      "type": "RAPID_MULTIPLE_PURCHASES",
      "severity": "HIGH",
      "description": "5 purchases in the last hour",
      "detectedAt": "2024-01-01T12:00:00Z"
    }
  ],
  "riskScore": 0.85
}
```

### 2. Gestión de Balances

#### Obtener Balance
```bash
GET /api/v1/users/{userId}/balance
Authorization: Bearer <JWT>
```

**Response:**
```json
{
  "success": true,
  "userId": "user123",
  "balance": 100.0,
  "currency": "USD"
}
```

### 3. Análisis de Fraude

#### Analizar Transacción
```bash
POST /api/v1/fraud/analyze
Authorization: Bearer <JWT>
Content-Type: application/json

{
  "userId": "user123",
  "action": "purchase_validation",
  "amount": 4.99,
  "paymentProvider": "GOOGLE_PLAY"
}
```

**Response:**
```json
{
  "success": true,
  "analysis": {
    "riskScore": 0.15,
    "recommendation": "ALLOW",
    "flags": [],
    "analyzedAt": "2024-01-01T12:00:00Z"
  }
}
```

### 4. Paquetes Disponibles

#### Listar Paquetes
```bash
GET /api/v1/packages
Authorization: Bearer <JWT>
```

**Response:**
```json
{
  "success": true,
  "packages": [
    {
      "id": "basic_pack_android",
      "name": "Basic Pack",
      "description": "100 stickers",
      "price": 4.99,
      "currency": "USD",
      "platform": "android"
    },
    {
      "id": "premium_pack_android",
      "name": "Premium Pack",
      "description": "500 stickers",
      "price": 9.99,
      "currency": "USD",
      "platform": "android"
    }
  ]
}
```

## Fraud Detection Rules

El sistema de detección de fraudes incluye múltiples capas:

### 1. Compras Rápidas Múltiples
- **Descripción**: Detecta múltiples compras en un período corto
- **Umbral**: 5+ compras en 1 hora
- **Peso de riesgo**: 0.3

### 2. Montos Inusuales
- **Descripción**: Identifica montos significativamente mayores al promedio
- **Umbral**: 3x el promedio histórico del usuario
- **Peso de riesgo**: 0.2

### 3. Anomalías de Ubicación
- **Descripción**: Detecta cambios de ubicación geográfica sospechosos
- **Umbral**: Nuevo país no visto en últimos 7 días
- **Peso de riesgo**: 0.25

### 4. Anomalías de Dispositivo
- **Descripción**: Identifica nuevos dispositivos no utilizados previamente
- **Umbral**: Nuevo device fingerprint en últimos 30 días
- **Peso de riesgo**: 0.4

### 5. Lista Negra
- **Descripción**: Usuarios marcados como de alto riesgo
- **Peso de riesgo**: 0.8

## Risk Scoring

- **0.0 - 0.29**: ALLOW (Transacción permitida)
- **0.30 - 0.59**: ADDITIONAL_VERIFICATION (Requiere verificación adicional)
- **0.60 - 0.79**: MANUAL_REVIEW (Requiere revisión manual)
- **0.80 - 1.00**: BLOCK (Transacción bloqueada)

## Headers Adicionales

Para mejor detección de fraudes, incluye estos headers en las peticiones:

```
X-Device-Fingerprint: unique_device_identifier
X-App-Version: app_version_number
X-Platform: android|ios
```

## Variables de Entorno

Configura estas variables en tu archivo `.env`:

```bash
# Google Play
GOOGLE_PLAY_PUBLIC_KEY="tu_clave_publica_google_play"

# Apple App Store
APPLE_APP_STORE_SECRET="tu_secret_apple_app_store"

# Encriptación
PAYMENT_ENCRYPTION_KEY="tu_clave_encriptacion"
```

## Ejemplos de Uso

### Flujo Completo de Compra

1. **Cliente obtiene JWT**:
```bash
POST /auth/token
```

2. **Cliente valida compra**:
```bash
POST /api/v1/payments/validate/google-play
Authorization: Bearer <JWT>
{
  "purchaseToken": "token_from_google_play",
  "productId": "basic_pack_android",
  "expectedAmount": 4.99
}
```

3. **Sistema procesa**:
   - Analiza fraude en tiempo real
   - Valida con Google Play
   - Actualiza balance si es válido
   - Registra transacción

4. **Cliente recibe respuesta** con nuevo balance y estado de la transacción.

## Manejo de Errores

### Errores Comunes

**400 Bad Request**:
```json
{
  "success": false,
  "error": "Missing required fields: purchaseToken, productId"
}
```

**401 Unauthorized**:
```json
{
  "success": false,
  "error": "Invalid or expired token"
}
```

**500 Internal Server Error**:
```json
{
  "success": false,
  "error": "Internal server error"
}
```

## Consideraciones de Seguridad

1. **Validación del Lado del Servidor**: Todas las compras se validan con los servidores oficiales
2. **Prevención de Replay Attacks**: Cada transacción tiene un ID único
3. **Encriptación**: Datos sensibles encriptados en reposo y tránsito
4. **Rate Limiting**: Límites de frecuencia para prevenir abusos
5. **Auditoría Completa**: Todas las transacciones son registradas

## Monitoreo

Métricas importantes a monitorear:
- Tasa de éxito de validaciones por proveedor
- Tiempos de respuesta de endpoints
- Detección de fraudes (falsos positivos/negativos)
- Estado de salud de servicios
