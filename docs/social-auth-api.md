# Social Authentication API Documentation

## Overview

PaymentCore ahora soporta autenticación social utilizando Google Sign-In y Apple Sign-In. Los usuarios pueden iniciar sesión con sus cuentas existentes y obtener automáticamente un token JWT para usar los servicios de pagos.

## Authentication Flow

### 1. Google Sign-In Flow
```
User → Google Sign-In → ID Token → Our Backend → JWT Payment Token
```

### 2. Apple Sign-In Flow
```
User → Apple Sign-In → Identity Token → Our Backend → JWT Payment Token
```

## Endpoints

### 1. Google Authentication

**Endpoint:** `POST /api/v1/auth/google`

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
  "user": {
    "id": "user_123456",
    "email": "user@gmail.com",
    "name": "John Doe",
    "picture": "https://lh3.googleusercontent.com/..."
  },
  "paymentToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "expiresIn": "15m"
}
```

### 2. Apple Authentication

**Endpoint:** `POST /api/v1/auth/apple`

**Request:**
```json
{
  "identityToken": "apple_identity_token_here",
  "userInfo": {
    "name": "John Doe",
    "email": "user@icloud.com"
  }
}
```

**Response:**
```json
{
  "success": true,
  "user": {
    "id": "user_789012",
    "email": "user@icloud.com",
    "name": "John Doe",
    "picture": null
  },
  "paymentToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "expiresIn": "15m"
}
```

### 3. Token Refresh

**Endpoint:** `POST /api/v1/auth/refresh`

**Headers:** `Authorization: Bearer <current_payment_token>`

**Request:**
```json
{}
```

**Response:**
```json
{
  "success": true,
  "paymentToken": "new_jwt_token_here",
  "expiresIn": "15m"
}
```

### 4. Token Verification

**Endpoint:** `GET /api/v1/auth/verify`

**Headers:** `Authorization: Bearer <payment_token>`

**Response:**
```json
{
  "success": true,
  "user": {
    "id": "user_123456",
    "email": "user@gmail.com",
    "name": "John Doe",
    "picture": "https://lh3.googleusercontent.com/..."
  },
  "expiresAt": "2024-01-01T12:15:00Z"
}
```

## Frontend Implementation Examples

### Android (Google Sign-In)

```kotlin
// 1. Configurar Google Sign-In
val googleSignInOptions = GoogleSignInOptions.Builder(GoogleSignInOptions.DEFAULT_SIGN_IN)
    .requestIdToken(getString(R.string.default_web_client_id))
    .requestEmail()
    .build()

val googleSignInClient = GoogleSignIn.getClient(this, googleSignInOptions)

// 2. Iniciar flujo de login
val signInIntent = googleSignInClient.signInIntent
startActivityForResult(signInIntent, RC_SIGN_IN)

// 3. Manejar resultado
override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
    super.onActivityResult(requestCode, resultCode, data)
    
    if (requestCode == RC_SIGN_IN) {
        val task = GoogleSignIn.getSignedInAccountFromIntent(data)
        handleGoogleSignInResult(task)
    }
}

private suspend fun handleGoogleSignInResult(completedTask: Task<GoogleSignInAccount>) {
    try {
        val account = completedTask.getResult(ApiException::class.java)
        val idToken = account.idToken!!
        
        // Enviar a nuestro backend
        val authResult = socialAuthService.authenticateWithGoogle(idToken)
        
        if (authResult.isSuccess) {
            val session = authResult.getOrThrow()
            // Guardar token y navegar a la app
            savePaymentSession(session)
        } else {
            // Manejar error
            showError("Authentication failed")
        }
    } catch (e: ApiException) {
        // Manejar error de Google Sign-In
    }
}
```

### iOS (Apple Sign-In)

```swift
// 1. Configurar Apple Sign-In
import AuthenticationServices

@objc func handleAppleSignIn() {
    let appleIDProvider = ASAuthorizationAppleIDProvider()
    let request = appleIDProvider.createRequest()
    request.requestedScopes = [.fullName, .email]
    
    let authorizationController = ASAuthorizationController(authorizationRequests: [request])
    authorizationController.delegate = self
    authorizationController.presentationContextProvider = self
    authorizationController.performRequests()
}

// 2. Manejar resultado
extension ViewController: ASAuthorizationControllerDelegate {
    func authorizationController(controller: ASAuthorizationController, didCompleteWithAuthorization authorization: ASAuthorization) {
        if let appleIDCredential = authorization.credential as? ASAuthorizationAppleIDCredential {
            let identityToken = String(data: appleIDCredential.identityToken!, encoding: .utf8)
            
            // Enviar a nuestro backend
            let userInfo = AppleUserInfo(
                name: appleIDCredential.fullName?.formatted(),
                email: appleIDCredential.email
            )
            
            Task {
                let authResult = await socialAuthService.authenticateWithApple(
                    identityToken: identityToken,
                    userInfo: userInfo
                )
                
                if authResult.success {
                    // Guardar token y navegar a la app
                    savePaymentSession(authResult)
                } else {
                    // Manejar error
                    showError("Authentication failed")
                }
            }
        }
    }
}
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
  "sub": "user_123456",           // User ID in our system
  "email": "user@gmail.com",        // User email
  "name": "John Doe",               // User name
  "provider": "google",             // Original auth provider
  "scope": ["payments", "stickers"], // Available scopes
  "iat": 1640995200,               // Issued at
  "exp": 1640996100                // Expires at
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

Configure estas variables en tu `.env`:

```bash
# Google Sign-In
GOOGLE_CLIENT_ID=your_google_client_id.apps.googleusercontent.com

# Apple Sign-In
APPLE_CLIENT_ID=com.yourapp.bundleid

# JWT Secret
JWT_SECRET=your_super_secret_jwt_key

# Optional: JWT expiration
JWT_EXPIRES_IN=15m
```

## Integration with PaymentCore

Una vez autenticado, el flujo de pagos funciona exactamente igual:

```kotlin
// 1. Usuario inicia sesión social
val session = paymentExample.loginWithGoogle(googleIdToken)

// 2. Usuario compra paquete
val purchaseResult = paymentExample.purchasePackage("basic_pack_android")

// 3. Backend valida con userId del JWT
// 4. Detección de fraudes y procesamiento normal
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
# Test Google authentication
curl -X POST http://localhost:3000/api/v1/auth/google \
  -H "Content-Type: application/json" \
  -d '{"idToken": "test_google_token"}'

# Test Apple authentication  
curl -X POST http://localhost:3000/api/v1/auth/apple \
  -H "Content-Type: application/json" \
  -d '{"identityToken": "test_apple_token", "userInfo": {"name": "Test User", "email": "test@example.com"}}'
```
