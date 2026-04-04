# Google Mock Service - Testing Guide

## Overview

El servicio Google Mock permite probar la aplicación completa sin depender del servicio real de Google Sign-In. Simula el flujo completo de autenticación de Google con usuarios de prueba predefinidos.

## 🚀 Quick Start

### 1. Habilitar Mock Service

Agrega esta variable a tu archivo `.env`:

```bash
ENABLE_GOOGLE_MOCK=true
NODE_ENV=development
```

### 2. Iniciar Backend

```bash
npm start
```

Verás este mensaje en la consola:
```
🧪 Google Mock endpoints enabled for testing
```

## 🧪 Mock Endpoints Disponibles

### 1. Página de Login Mock

**URL:** `GET http://localhost:3000/mock/google/auth`

**Parámetros:**
- `redirect_uri` - URL de redirección de tu app
- `state` - Estado CSRF
- `client_id` - Client ID (opcional para mock)
- `scope` - Permisos solicitados

**Ejemplo:**
```
http://localhost:3000/mock/google/auth?redirect_uri=http://localhost:8080/callback&state=abc123&client_id=test&scope=openid%20email%20profile
```

### 2. API de Token de Prueba

**URL:** `GET http://localhost:3000/api/v1/mock/google/test-token`

**Parámetros:**
- `email` - Email del usuario de prueba (opcional, default: test.user@gmail.com)

**Response:**
```json
{
  "success": true,
  "testToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "expiresIn": "1h",
  "userInfo": {
    "id": "google_mock_user_1",
    "email": "test.user@gmail.com",
    "name": "Test User",
    "picture": "https://via.placeholder.com/150/150/4285F4/FFFFFF?text=Test"
  }
}
```

### 3. Lista de Usuarios de Prueba

**URL:** `GET http://localhost:3000/api/v1/mock/google/users`

**Response:**
```json
{
  "success": true,
  "users": [
    {
      "id": "google_mock_user_1",
      "email": "test.user@gmail.com",
      "name": "Test User",
      "picture": "https://via.placeholder.com/150/150/4285F4/FFFFFF?text=Test"
    },
    {
      "id": "google_mock_user_2",
      "email": "developer@gmail.com",
      "name": "Developer User",
      "picture": "https://via.placeholder.com/150/150/4285F4/FFFFFF?text=Dev"
    },
    {
      "id": "google_mock_user_3",
      "email": "premium.user@gmail.com",
      "name": "Premium User",
      "picture": "https://via.placeholder.com/150/150/4285F4/FFFFFF?text=Premium"
    }
  ]
}
```

### 4. Crear Nuevo Usuario de Prueba

**URL:** `POST http://localhost:3000/api/v1/mock/google/users`

**Body:**
```json
{
  "email": "new.user@test.com",
  "name": "New Test User",
  "picture": "https://via.placeholder.com/150/150/4285F4/FFFFFF?text=New"
}
```

## 📱 Frontend Integration

### Android (Kotlin)

```kotlin
class MockGoogleSignInManager {
    
    private val googleMockService = GoogleMockServiceImpl(
        httpClient = httpClient,
        backendUrl = "http://localhost:3000",
        enabled = BuildConfig.DEBUG // Solo habilitar en debug
    )
    
    suspend fun signInWithMock(email: String = "test.user@gmail.com"): Result<UserPaymentSession> {
        return try {
            // 1. Obtener token de prueba
            val mockTokenResult = googleMockService.getTestToken(email)
            
            if (mockTokenResult.isSuccess) {
                val mockToken = mockTokenResult.getOrThrow()
                
                // 2. Usar token como si fuera de Google real
                val authResult = socialAuthService.authenticateWithGoogle(mockToken.testToken)
                
                if (authResult.isSuccess) {
                    val result = authResult.getOrThrow()
                    Result.success(
                        UserPaymentSession(
                            userId = result.user!!.id,
                            email = result.user.email,
                            name = result.user.name,
                            paymentToken = result.paymentToken,
                            provider = "google-mock"
                        )
                    )
                } else {
                    Result.failure(Exception("Mock authentication failed"))
                }
            } else {
                Result.failure(Exception("Failed to get mock token"))
            }
        } catch (e: Exception) {
            Result.failure(e)
        }
    }
    
    suspend fun openMockAuthPage(): String {
        return googleMockService.getMockAuthPage(
            redirectUri = "aistickersapp://auth",
            state = UUID.randomUUID().toString()
        )
    }
}
```

### Uso en Activity

```kotlin
class MainActivity : AppCompatActivity() {
    
    private val mockSignInManager = MockGoogleSignInManager()
    
    private fun setupMockSignInButton() {
        if (BuildConfig.DEBUG) {
            // Mostrar botón de mock solo en debug
            val mockButton = Button(this).apply {
                text = "🧪 Sign In with Mock Google"
                setOnClickListener {
                    CoroutineScope(Dispatchers.Main).launch {
                        val result = mockSignInManager.signInWithMock()
                        
                        if (result.isSuccess) {
                            val session = result.getOrThrow()
                            navigateToMainScreen(session)
                        } else {
                            showError("Mock sign in failed")
                        }
                    }
                }
            }
            
            // Agregar botón al layout
            findViewById<LinearLayout>(R.id.auth_layout).addView(mockButton)
        }
    }
}
```

## 🧪 Testing Automatizado

### Flujo Completo de Prueba

```kotlin
class MockPaymentTest {
    
    private val mockPaymentExample = MockPaymentExample(/* dependencies */)
    
    suspend fun runCompleteTestSuite(): TestSuiteResult {
        val results = mutableListOf<TestFlowResult>()
        
        try {
            println("🧪 Iniciando suite de pruebas...")
            
            // 1. Probar flujo completo con usuario por defecto
            val singleUserResult = mockPaymentExample.runCompleteTestFlow()
            results.add(singleUserResult.getOrThrow())
            
            // 2. Probar múltiples usuarios
            val multiUserResult = mockPaymentExample.testMultipleUsers()
            if (multiUserResult.isSuccess) {
                results.addAll(multiUserResult.getOrThrow())
            }
            
            // 3. Analizar resultados
            val successCount = results.count { it.success }
            val totalCount = results.size
            
            return TestSuiteResult(
                totalTests = totalCount,
                successfulTests = successCount,
                failedTests = totalCount - successCount,
                successRate = (successCount.toDouble() / totalCount) * 100,
                results = results
            )
            
        } catch (e: Exception) {
            return TestSuiteResult(
                totalTests = 0,
                successfulTests = 0,
                failedTests = 1,
                successRate = 0.0,
                error = e.message
            )
        }
    }
}
```

### Ejecución de Tests

```kotlin
// En tu Application o Activity de testing
class TestApplication : Application() {
    
    override fun onCreate() {
        super.onCreate()
        
        if (BuildConfig.DEBUG) {
            CoroutineScope(Dispatchers.IO).launch {
                val testSuite = MockPaymentTest().runCompleteTestSuite()
                
                println("📊 Resultados de Testing:")
                println("Total: ${testSuite.totalTests}")
                println("Exitosos: ${testSuite.successfulTests}")
                println("Fallidos: ${testSuite.failedTests}")
                println("Tasa de éxito: ${"%.2f".format(testSuite.successRate)}%")
                
                if (testSuite.failedTests > 0) {
                    println("❌ Tests fallidos:")
                    testSuite.results.filter { !it.success }.forEach { result ->
                        println("  - ${result.user.email}: ${result.error}")
                    }
                }
            }
        }
    }
}
```

## 🔧 Configuración Avanzada

### Variables de Entorno

```bash
# Habilitar mock service
ENABLE_GOOGLE_MOCK=true

# Entorno de desarrollo
NODE_ENV=development

# Client ID para mock (opcional)
GOOGLE_CLIENT_ID=test-google-client-id.apps.googleusercontent.com

# JWT Secret para mock tokens
JWT_SECRET=mock_jwt_secret_for_testing_only
```

### Personalizar Usuarios de Prueba

Modifica `src/services/googleMock.service.js`:

```javascript
initMockUsers() {
    const testUsers = [
        {
            id: 'custom_user_1',
            email: 'custom@test.com',
            name: 'Custom User',
            picture: 'https://example.com/avatar.jpg',
            password: 'custom123'
        },
        // Agrega más usuarios...
    ];
    
    testUsers.forEach(user => {
        this.mockUsers.set(user.email, user);
    });
}
```

## 📊 Escenarios de Testing

### 1. Flujo Feliz (Happy Path)
```bash
# 1. Obtener token de prueba
curl "http://localhost:3000/api/v1/mock/google/test-token?email=test.user@gmail.com"

# 2. Autenticar con nuestro backend
curl -X POST http://localhost:3000/api/v1/auth/google \
  -H "Content-Type: application/json" \
  -d '{"idToken": "token_del_paso_1"}'

# 3. Usar token para comprar
curl -X POST http://localhost:3000/api/v1/payments/validate/google-play \
  -H "Authorization: Bearer token_del_paso_2" \
  -H "Content-Type: application/json" \
  -d '{
    "purchaseToken": "mock_purchase_token",
    "productId": "basic_pack_android",
    "expectedAmount": 4.99
  }'
```

### 2. Testing de Errores

```bash
# Token inválido
curl -X POST http://localhost:3000/api/v1/auth/google \
  -H "Content-Type: application/json" \
  -d '{"idToken": "invalid_token"}'

# Usuario no existe
curl "http://localhost:3000/api/v1/mock/google/test-token?email=nonexistent@test.com"

# Email requerido
curl -X POST http://localhost:3000/api/v1/mock/google/users \
  -H "Content-Type: application/json" \
  -d '{"name": "Test"}'
```

## 🎯 Casos de Uso Recomendados

### 1. Desarrollo Local
```kotlin
if (BuildConfig.DEBUG) {
    // Usar mock para desarrollo rápido
    val mockService = GoogleMockServiceImpl(httpClient, "http://localhost:3000", enabled = true)
}
```

### 2. Testing Automatizado
```kotlin
@Test
fun testCompletePaymentFlow() = runTest {
    val mockExample = MockPaymentExample(/* dependencies */)
    val result = mockExample.runCompleteTestFlow()
    
    assertTrue(result.isSuccess)
    val flowResult = result.getOrThrow()
    assertTrue(flowResult.success)
    assertNotNull(flowResult.purchaseTransactionId)
    assertTrue(flowResult.balanceChange!! > 0)
}
```

### 3. Demostración
```kotlin
// Para presentaciones o demos
fun setupDemoMode() {
    val mockService = GoogleMockServiceImpl(httpClient, backendUrl, enabled = true)
    // Configurar usuario demo automático
    mockService.signInWithMock("demo.user@test.com")
}
```

## 🔍 Debugging y Troubleshooting

### Logs del Backend

El servicio mock genera logs detallados:

```bash
# Iniciar con logs detallados
DEBUG=* npm start

# Ver logs específicos del mock
DEBUG=google-mock npm start
```

### Problemas Comunes

**1. Mock no habilitado:**
```
Error: Google Mock service is not enabled
```
**Solución:** Agregar `ENABLE_GOOGLE_MOCK=true` al `.env`

**2. Token expirado:**
```
Error: Mock session expired
```
**Solución:** Generar nuevo token con `/api/v1/mock/google/test-token`

**3. Usuario no encontrado:**
```
Error: Test user not found: email@test.com
```
**Solución:** Crear usuario con `/api/v1/mock/google/users`

## 📈 Métricas de Testing

El mock service incluye métricas automáticas:

- **Tokens generados:** Conteo de tokens de prueba creados
- **Usuarios creados:** Nuevos usuarios de prueba
- **Autenticaciones exitosas:** Logins mock completados
- **Errores simulados:** Different error scenarios tested

## 🎉 Beneficios del Mock Service

✅ **Testing Offline** - No requiere conexión a Google  
✅ **Datos Controlados** - Usuarios y datos predecibles  
✅ **Escenarios de Error** - Simular fallos específicos  
✅ **Testing Automatizado** - Integración con tests unitarios  
✅ **Desarrollo Rápido** - Sin configuración OAuth real  
✅ **Costo Cero** - Sin cuotas de APIs de Google  
✅ **Reproducibilidad** - Mismos resultados siempre  

## 🔄 Transición a Producción

Para cambiar de mock a producción:

```kotlin
val googleMockEnabled = BuildConfig.DEBUG && !BuildConfig.PRODUCTION_MODE

val authService = if (googleMockEnabled) {
    SocialAuthServiceImpl(httpClient, "http://localhost:3000")
} else {
    SocialAuthServiceImpl(httpClient, "https://tu-backend-real.com")
}
```

¡Listo! Ahora puedes probar toda la aplicación de pagos sin depender del servicio real de Google 🚀
