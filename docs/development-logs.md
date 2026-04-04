# Development Logs - Guía Completa

## Overview

Sistema de logs detallados para desarrollo que muestra todas las conexiones, requests y responses con información completa de debugging.

## 🚀 Activación

### Método 1: Automático en Development
```bash
NODE_ENV=development npm start
```

### Método 2: Variable Específica
```bash
ENABLE_DEVELOPMENT_LOGS=true npm start
```

### Método 3: Combinación Completa
```bash
NODE_ENV=development ENABLE_DEVELOPMENT_LOGS=true ENABLE_MOCK=true npm start
```

## 📊 Logs Disponibles

### 1. Morgan HTTP Logs
```
GET /api/v1/mock/google/test-token 200 15.123 ms - 245
POST /api/v1/auth/google 200 45.678 ms - 156
```

### 2. Request Logs Detallados
```
📝 [2026-04-04T14:52:15.123Z] POST /api/v1/auth/google
   IP: ::1 | User-Agent: Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)
   Headers: {
     "content-type": "application/json",
     "authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
     "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
     "accept": "*/*",
     "host": "localhost:3000",
     "connection": "keep-alive"
   }
   Body: {
     "idToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
   }
```

### 3. Response Logs
```
📤 [2026-04-04T14:52:15.189Z] Response 200 for POST /api/v1/auth/google
   Response: {
     "success": true,
     "user": {
       "id": "google_mock_user_1",
       "email": "test.user@gmail.com",
       "name": "Test User"
     },
     "paymentToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
     "expiresIn": "15m"
   }
```

### 4. File Upload Logs
```
📝 [2026-04-04T14:55:22.456Z] POST /process-image
   IP: ::1 | User-Agent: PostmanRuntime/7.32.3
   Headers: {
     "content-type": "multipart/form-data; boundary=----WebKitFormBoundary...",
     "authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
   }
   File: {
     "fieldname": "image",
     "originalname": "test-sticker.jpg",
     "encoding": "7bit",
     "mimetype": "image/jpeg",
     "size": 245678,
     "destination": "/var/www/aiStickers_Backend/src/public/uploads",
     "filename": "abc123def456.jpg",
     "path": "/var/www/aiStickers_Backend/src/public/uploads/abc123def456.jpg"
   }
```

## 🔍 Información que se Loguea

### Request Information:
- ✅ **Timestamp** - ISO 8601 format
- ✅ **Method + URL** - HTTP method y endpoint
- ✅ **IP Address** - Cliente IP
- ✅ **User-Agent** - Browser/client info
- ✅ **Headers** - Todos los headers HTTP
- ✅ **Body** - Payload JSON (si existe)
- ✅ **Files** - Información de archivos subidos

### Response Information:
- ✅ **Timestamp** - Cuándo se envió la respuesta
- ✅ **Status Code** - HTTP status (200, 400, 500, etc.)
- ✅ **Response Body** - Response JSON limitado
- ✅ **Duration** - Tiempo de procesamiento (via Morgan)

## 📱 Ejemplos de Uso

### 1. Login con Google Mock
```bash
# Request
curl -X POST http://localhost:3000/api/v1/auth/google \
  -H "Content-Type: application/json" \
  -d '{"idToken": "mock_token_123"}'

# Logs generados:
📝 [2026-04-04T14:52:15.123Z] POST /api/v1/auth/google
   IP: ::1 | User-Agent: curl/7.79.1
   Headers: {
     "content-type": "application/json",
     "user-agent": "curl/7.79.1",
     "accept": "*/*",
     "host": "localhost:3000"
   }
   Body: {
     "idToken": "mock_token_123"
   }

📤 [2026-04-04T14:52:15.189Z] Response 200 for POST /api/v1/auth/google
   Response: {
     "success": true,
     "user": {
       "id": "google_mock_user_1",
       "email": "test.user@gmail.com",
       "name": "Test User"
     },
     "paymentToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
     "expiresIn": "15m"
   }
```

### 2. Procesar Imagen
```bash
# Request
curl -X POST http://localhost:3000/process-image \
  -H "Authorization: Bearer token_jwt" \
  -F "image=@test.jpg" \
  -F "prompt=Christmas sticker"

# Logs generados:
📝 [2026-04-04T14:55:22.456Z] POST /process-image
   IP: ::1 | User-Agent: curl/7.79.1
   Headers: {
     "authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
     "content-type": "multipart/form-data; boundary=----WebKitFormBoundary...",
     "user-agent": "curl/7.79.1"
   }
   File: {
     "fieldname": "image",
     "originalname": "test.jpg",
     "encoding": "7bit",
     "mimetype": "image/jpeg",
     "size": 123456,
     "filename": "abc123def456.jpg"
   }

📤 [2026-04-04T14:55:22.789Z] Response 200 for POST /process-image
   Response: {
     "stickerUrl": "https://animatedsticker.com/aistickers/mock-christmas-sticker-2.png",
     "replicateId": "mock_replicate_id_2",
     "web": "https://replicate.com/mock/sticker/2"
   }
```

### 3. Error Logs
```bash
# Request con error
curl -X POST http://localhost:3000/api/v1/auth/google \
  -H "Content-Type: application/json" \
  -d '{}'

# Logs generados:
📝 [2026-04-04T14:58:30.111Z] POST /api/v1/auth/google
   IP: ::1 | User-Agent: curl/7.79.1
   Headers: {
     "content-type": "application/json",
     "user-agent": "curl/7.79.1"
   }
   Body: {}

📤 [2026-04-04T14:58:30.115Z] Response 400 for POST /api/v1/auth/google
   Response: {
     "success": false,
     "error": "Google ID token is required"
   }
```

## 🛠️ Configuración Avanzada

### Variables de Entorno
```bash
# Activar logs development
ENABLE_DEVELOPMENT_LOGS=true

# Activar mocks
ENABLE_MOCK=true

# Entorno (activa automáticamente los logs)
NODE_ENV=development

# Puerto del servidor
PORT=3000
```

### Niveles de Logs
```javascript
// En index.js puedes personalizar el nivel de detalle:

if (process.env.NODE_ENV === 'development') {
  // Logs completos (default)
  app.use(morgan('dev'));
  
  // Opciones adicionales:
  // app.use(morgan('combined'));  // Logs estilo Apache
  // app.use(morgan('tiny'));      // Logs mínimos
  // app.use(morgan('short'));     // Logs cortos
}
```

### Formato Personalizado
```javascript
// Personalizar formato de logs:
app.use(morgan(':method :url :status :res[content-length] - :response-time ms'));
```

## 📊 Análisis de Logs

### 1. Identificar Problemas
```bash
# Buscar errores
grep "Response 4" server.log
grep "Response 5" server.log

# Buscar requests lentos
grep "ms - " server.log | awk '$NF > 1000'

# Buscar IPs específicas
grep "IP: 192.168.1" server.log
```

### 2. Estadísticas
```bash
# Contar requests por endpoint
grep "POST /api/v1/auth/google" server.log | wc -l

# Tiempo promedio de respuesta
grep "ms - " server.log | awk '{sum+=$(NF-1); count++} END {print "Avg:", sum/count, "ms"}'

# Top user agents
grep "User-Agent:" server.log | sort | uniq -c | sort -nr | head -10
```

### 3. Debugging de Flujo
```bash
# Seguir un flujo completo
grep -A 10 -B 2 "paymentToken" server.log

# Ver solo requests exitosos
grep "Response 200" server.log

# Ver solo requests fallidos
grep -E "Response [45][0-9][0-9]" server.log
```

## 🔧 Troubleshooting

### Logs No Aparecen
```bash
# Verificar variables
echo $NODE_ENV
echo $ENABLE_DEVELOPMENT_LOGS

# Forzar activación
ENABLE_DEVELOPMENT_LOGS=true npm start
```

### Logs Muy Verbosos
```bash
# Reducir verbosidad (comenta el middleware de body logs)
# En index.js, comenta estas líneas:
// if (req.body && Object.keys(req.body).length > 0) {
//   console.log(`   Body:`, JSON.stringify(req.body, null, 2));
// }
```

### Performance Impact
Los logs solo se activan en development, no afectan producción:
- ✅ **NODE_ENV=production** → Logs desactivados
- ✅ **Sin variables** → Logs desactivados  
- ✅ **Solo development** → Logs activados

## 📱 Integración con Frontend

### Debug desde Frontend
```javascript
// Agregar timestamp a cada request para correlacionar logs
const timestamp = new Date().toISOString();
fetch('/api/v1/auth/google', {
  headers: {
    'X-Request-ID': timestamp,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({ idToken })
});
```

### Correlacionar Logs
```bash
# Buscar por timestamp específico
grep "2026-04-04T14:52:15" server.log
```

## 🎯 Mejores Prácticas

### 1. Development
```bash
# Máximo detalle para debugging
NODE_ENV=development ENABLE_DEVELOPMENT_LOGS=true npm start
```

### 2. Testing
```bash
# Logs básicos para testing
NODE_ENV=test npm test
```

### 3. Staging
```bash
# Sin logs detallados en staging
NODE_ENV=production npm start
```

### 4. Producción
```bash
# Sin logs de development
NODE_ENV=production npm start
# Usar sistema de logs profesional (Winston, Papertrail, etc.)
```

## 🚀 Beneficios

✅ **Debugging Rápido** - Información completa de cada request  
✅ **Correlación** - Timestamps para seguir flujos completos  
✅ **Seguridad** - Solo en development, no expone datos sensibles  
✅ **Performance** - Sin impacto en producción  
✅ **Flexibilidad** - Activable por variable de entorno  
✅ **Estándar** - Usa Morgan (industria standard)  

**¡Ahora tienes visibilidad completa de todas las conexiones y requests en development!** 🎉
