# PaymentCore API Documentation

## Overview

Servicio de pagos con verificación real contra Google Play Developer API. Soporta compras de Google Play y Apple App Store, gestión de balances (JSON file), y detección de fraudes básica.

## Autenticación

Todos los endpoints requieren dos capas:
- **Firma HMAC de app** (`X-App-Id`, `X-App-Timestamp`, `X-App-Nonce`, `X-App-Signature`) — generada por `:authcore` con HMAC-SHA256
- **JWT de usuario** (`Authorization: Bearer <token>`) — obtenido tras login con Google

## Endpoints

### Validación de Compras

#### Google Play
```
POST /api/v1/payments/validate/google-play
Headers: X-App-Id, X-App-Timestamp, X-App-Nonce, X-App-Signature, Authorization: Bearer <JWT>
```
```json
{
  "purchaseToken": "google_play_purchase_token",
  "productId": "com.animatedsticker.aistickers.basic_25",
  "amount": 25
}
```

**Verificación real:** El backend llama a `purchases.products.get` de la Google Play Developer API.
- `purchaseState = 0` → válido, suma balance
- `purchaseState = 1` → rechazado (cancelado por Google)
- `purchaseState = 2` → rechazado (pendiente de confirmación de pago)

**Response exitoso:**
```json
{
  "success": true,
  "transactionId": "uuid",
  "newBalance": 25
}
```

#### Apple App Store
```
POST /api/v1/payments/validate/apple-app-store
Headers: X-App-Id, X-App-Timestamp, X-App-Nonce, X-App-Signature, Authorization: Bearer <JWT>
```
```json
{
  "receiptData": "apple_receipt_data",
  "productId": "com.animatedsticker.aistickers.basic_25"
}
```
> ⚠️ La verificación con Apple sigue siendo simulada. Pendiente de implementar.

### Balance

```
GET /api/v1/users/balance
Headers: X-App-Id, X-App-Timestamp, X-App-Nonce, X-App-Signature, Authorization: Bearer <JWT>
```
```json
{ "balance": 25 }
```

```
GET /api/v1/users/balance/history
Headers: X-App-Id, X-App-Timestamp, X-App-Nonce, X-App-Signature, Authorization: Bearer <JWT>
```

```
POST /api/v1/users/balance/spend
Headers: X-App-Id, X-App-Timestamp, X-App-Nonce, X-App-Signature, Authorization: Bearer <JWT>
```
```json
{ "amount": 1 }
```

### Planes de compra

```
GET /api/v1/plans
Headers: X-App-Id, X-App-Timestamp, X-App-Nonce, X-App-Signature, Authorization: Bearer <JWT>
```
```json
[
  {
    "id": "basic_25",
    "name": "Basic Pack",
    "stickerCount": 25,
    "productId": "com.animatedsticker.aistickers.basic_25",
    "price": 0.99,
    "currency": "EUR"
  }
]
```

### Traducciones

```
GET /api/v1/i18n/:lang
Headers: X-App-Id, X-App-Timestamp, X-App-Nonce, X-App-Signature
```
```json
{ "version": 1715000000000, "data": { "app_title": "AI Stickers", "buy_button": "Comprar" } }
```

### Config (force update)

```
GET /api/v1/config
Headers: X-App-Id, X-App-Timestamp, X-App-Nonce, X-App-Signature
```
```json
{
  "minVersion": "0.0.9",
  "forceUpdate": false,
  "storeUrl": {
    "android": "https://play.google.com/store/apps/details?id=com.animatedsticker.aistickers",
    "ios": "https://apps.apple.com/app/id000000000"
  }
}
```
> Para forzar actualización: cambiar `forceUpdate: true` o subir `minVersion` en `src/infrastructure/web/controllers/config.controller.js`.

## Storage

- **Balance:** JSON file en `data/balances.json` (en memoria + auto-save cada 30s)
- **Assets (stickers/paquetes):** JSON file en `data/user_assets.json`

## Variables de Entorno relevantes

```bash
GOOGLE_SERVICE_ACCOUNT_PATH=/ruta/secrets/google-service-account.json
GOOGLE_PLAY_PACKAGE_NAME=com.animatedsticker.aistickers
CLIENT_ID=...
CLIENT_SECRET=...
JWT_SECRET=...
```

## Errores comunes

| Código | Causa |
|--------|-------|
| 400 | Faltan campos `purchaseToken` o `productId` |
| 401 Bad signature | HMAC incorrecto — verificar que el body se incluye en la firma |
| 401 Unauthorized | JWT expirado o inválido |
| 402 | Compra cancelada o pendiente según Google Play |
| 403 | Service account sin permisos en Play Console |
