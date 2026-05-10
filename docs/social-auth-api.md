# Social Authentication API Documentation

## Overview

PaymentCore ahora soporta autenticación social utilizando Google Sign-In y Apple Sign-In. Los usuarios pueden iniciar sesión con sus cuentas existentes y obtener automáticamente un token JWT para usar los servicios de pagos.

**⚠️ IMPORTANTE**: Todos los endpoints de autenticación requieren firma HMAC de la aplicación (ver [architecture.md](./architecture.md#security-architecture)).

## Headers Requeridos

Todas las peticiones deben incluir los headers HMAC generados por `:authcore`:

```
X-App-Id: <client-id>
X-App-Timestamp: <unix-epoch-seconds>
X-App-Nonce: <uuid>
X-App-Signature: <hmac-sha256-hex>
```

Canonical string firmado: `timestamp.nonce.METHOD.path.bodyHash`

Para endpoints con user JWT también:
```
Authorization: Bearer <jwt-token>
```

## Authentication Flow

### Google Sign-In Flow
```
User → Google Sign-In (Credential Manager) → ID Token
  → SessionService (:userauth) → POST /api/v1/auth/google (HMAC)
  → Backend verifica con Google → JWT guardado en TokenStorage
```

> ⚠️ Apple Sign-In: pendiente de implementar en iOS.

## Endpoints

### 1. App Token (HMAC only)

**Endpoint:** `POST /api/v1/auth/token`  
**Seguridad:** HMAC

**Request:** body vacío `{}`

**Response:**
```json
{
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "expiresIn": "24h"
}
```

---

### 2. Google Sign-In

**Endpoint:** `POST /api/v1/auth/google`  
**Seguridad:** HMAC

**Request:**
```json
{
  "idToken": "google_id_token_here"
}
```

**Response:**
```json
{
  "success": true,
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "user": {
    "email": "user@gmail.com",
    "name": "John Doe",
    "picture": "https://lh3.googleusercontent.com/..."
  }
}
```

---

### 3. Validar Sesión

**Endpoint:** `GET /api/v1/auth/me`  
**Seguridad:** HMAC + User JWT

**Response:**
```json
{
  "valid": true,
  "user": {
    "email": "user@gmail.com",
    "name": "John Doe"
  }
}
```

---

### 4. Logout

**Endpoint:** `POST /api/v1/auth/logout`  
**Seguridad:** HMAC + User JWT

**Response:**
```json
{ "success": true }
```

## Frontend Implementation

El frontend usa `UserAuthManager` (:userauth) como único punto de entrada:

```kotlin
// Android — iniciar login
UserAuthManager.requireLogin() // → GoogleAuthProvider (Credential Manager API)

// Flujo interno en SessionService.kt
val body = """{"idToken":"$googleIdToken"}"""
val hmac = AuthCoreManager.getHmacHeaders("POST", "/api/v1/auth/google", body)
val response = httpClient.post("$baseUrl/api/v1/auth/google") {
    contentType(ContentType.Application.Json)
    setBody(body)
    hmac.forEach { (k, v) -> header(k, v) }
}
// Token guardado en TokenStorage (EncryptedSharedPreferences)
```

## Security Considerations

### 1. Token Validation

**Google:**
- Verificar ID token con Google Auth Library
- Validar audience (client ID)
- Validar issuer (accounts.google.com)
- Validar expiration

**Apple:**
- Verificar identity token JWT
- Validar issuer (https://appleid.apple.com)
- Validar audience (App Bundle ID)
- Validar expiration

### 2. User Creation Flow

```javascript
// Backend: findOrCreateUser logic
async function findOrCreateUser(userInfo) {
    // 1. Buscar usuario por provider ID
    let existingUser = await findUserByProviderId(userInfo.id, userInfo.provider);
    
    if (existingUser) {
        // 2. Actualizar último login
        await updateUserLastLogin(existingUser.id);
        return existingUser;
    }
    
    // 3. Crear nuevo usuario
    const newUser = await createUser({
        id: generateUniqueId(),
        providerId: userInfo.id,
        provider: userInfo.provider,
        email: userInfo.email,
        name: userInfo.name,
        picture: userInfo.picture,
        createdAt: new Date(),
        lastLoginAt: new Date(),
        isActive: true
    });
    
    return newUser;
}
```

### 3. JWT Token Structure

```json
{
  "sub": "user@gmail.com",         // Email como ID principal
  "email": "user@gmail.com",
  "name": "John Doe",
  "googleId": "123456789",
  "type": "user",
  "scope": ["stickers"],
  "iat": 1640995200,
  "exp": 1640995200
}
```

## Error Handling

### Common Errors

**400 Bad Request:**
```json
{
  "success": false,
  "error": "Google ID token is required"
}
```

**401 Unauthorized:**
```json
{
  "success": false,
  "error": "Invalid Google token"
}
```

**500 Internal Server Error:**
```json
{
  "success": false,
  "error": "Internal server error during Google authentication"
}
```

## Environment Variables

```bash
# Google Sign-In
GOOGLE_CLIENT_ID=your_google_client_id.apps.googleusercontent.com

# HMAC
CLIENT_ID=ai-stickers-android
CLIENT_SECRET=your_hmac_secret

# JWT
JWT_SECRET=your_super_secret_jwt_key
JWT_EXPIRES_IN=24h
```

## Integration con el Frontend

Una vez autenticado via `UserAuthManager`:

```kotlin
// JWT disponible en cualquier módulo
val jwt = UserAuthManager.getCurrentJwt()

// PaymentCoreViewModel lo usa para validar compras
val headers = AuthCoreManager.getHeaders("POST", "/api/v1/payments/validate/google-play", body, jwt)
```

## Benefits

✅ **No registration required** - Users use existing accounts  
✅ **Faster onboarding** - One-click authentication  
✅ **Secure** - OAuth 2.0 + JWT tokens  
✅ **Cross-platform** - Google + Apple support  
✅ **Automatic user creation** - No manual user management  
✅ **Token refresh** - Seamless session management  

## Testing

### Google Sign-In Testing

1. Usa Google Sign-In para testing: `GOOGLE_CLIENT_ID=test_client_id`
2. Google proporciona tokens de prueba para desarrollo

### Apple Sign-In Testing

1. Usa sandbox de Apple para testing
2. Apple proporciona tokens de prueba para desarrollo

### Backend Testing

```bash
# El endpoint requiere HMAC — usar la app Android para generar headers válidos.
# Health check (sin HMAC):
curl http://animatedsticker.com:22024/health
```
