# AI Mock Service - Testing Guide

## Overview

El servicio AI Mock permite probar los endpoints de generación de stickers y videos sin depender de los servicios reales de Replicate. Simula respuestas realistas para desarrollo y testing.

## 🚀 Quick Start

### 1. Habilitar Mock de AI

Agrega esta variable a tu archivo `.env`:

```bash
ENABLE_MOCK=true
NODE_ENV=development
```

### 2. Iniciar Backend

```bash
npm start
```

Verás mensajes en la consola cuando se usen respuestas mock:
```
🧪 Using AI mock response
🧪 Using AI img2vid mock response
```

## 🧪 Mock Endpoints Modificados

### 1. Process Image Mock

**Endpoint:** `POST /process-image`

**Flujo Mock:**
- Recibe archivo de imagen y prompt
- Elimina archivo temporal
- Retorna sticker mock aleatorio
- Simula respuesta de Replicate

**Response Mock:**
```json
{
  "stickerUrl": "https://animatedsticker.com/aistickers/824e1297-6ed1-4886-b7c9-910631790b6d.jpg",
  "replicateId": "mock_replicate_id_1",
  "web": "https://replicate.com/mock/sticker/1"
}
```

**Stickers Mock Disponibles:**
```javascript
const mockResponses = [
  {
    stickerUrl: "https://animatedsticker.com/aistickers/824e1297-6ed1-4886-b7c9-910631790b6d.jpg",
    replicateId: "mock_replicate_id_1",
    web: "https://replicate.com/mock/sticker/1"
  },
  {
    stickerUrl: "https://animatedsticker.com/aistickers/mock-christmas-sticker-2.png",
    replicateId: "mock_replicate_id_2", 
    web: "https://replicate.com/mock/sticker/2"
  },
  {
    stickerUrl: "https://animatedsticker.com/aistickers/mock-festive-sticker-3.jpg",
    replicateId: "mock_replicate_id_3",
    web: "https://replicate.com/mock/sticker/3"
  }
];
```

### 2. Image to Video Mock

**Endpoint:** `POST /img2vid`

**Flujo Mock:**
- Recibe URL de imagen y parámetros
- Retorna video mock aleatorio
- Simula procesamiento de video

**Response Mock:**
```json
{
  "videoUrl": "https://animatedsticker.com/aistickers/mock-video-1.mp4"
}
```

**Videos Mock Disponibles:**
```javascript
const mockVideoResponses = [
  "https://animatedsticker.com/aistickers/mock-video-1.mp4",
  "https://animatedsticker.com/aistickers/mock-video-2.mp4", 
  "https://animatedsticker.com/aistickers/mock-video-3.mp4"
];
```

## 🔄 Control de Mock

### Variables de Entorno

```bash
# Habilitar todos los mocks
ENABLE_MOCK=true

# Entorno de desarrollo (también habilita mocks)
NODE_ENV=development
```

### Lógica de Activación

```javascript
// Los mocks se activan cuando:
if (process.env.NODE_ENV === 'development' || process.env.ENABLE_MOCK === 'true') {
  // Usar respuesta mock
  console.log("🧪 Using AI mock response");
} else {
  // Usar servicio real de Replicate
  const result = await runStickerModel(signedUrl, finalPrompt);
}
```

## 📱 Testing con Frontend

### Ejemplo de Uso

```javascript
// Subir imagen para procesar
const formData = new FormData();
formData.append('image', fileInput.files[0]);
formData.append('prompt', 'Christmas themed sticker');

const response = await fetch('/process-image', {
  method: 'POST',
  body: formData,
  headers: {
    'Authorization': `Bearer ${token}`
  }
});

const result = await response.json();
console.log('Sticker generado:', result.stickerUrl);
```

### Testing con cURL

```bash
# 1. Subir imagen para procesar (mock)
curl -X POST http://localhost:3000/process-image \
  -H "Authorization: Bearer your_jwt_token" \
  -F "image=@/path/to/image.jpg" \
  -F "prompt=Christmas sticker"

# 2. Convertir imagen a video (mock)
curl -X POST http://localhost:3000/img2vid \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer your_jwt_token" \
  -d '{
    "imageUrl": "https://example.com/image.jpg",
    "prompt": "Animated Christmas sticker",
    "duration": 3,
    "fps": 24
  }'
```

## 🎯 Escenarios de Testing

### 1. Desarrollo Rápido
```bash
# Activar todos los mocks
ENABLE_MOCK=true
npm start
```

### 2. Testing Parcial
```bash
# Solo mocks (AI + Google), sin entorno desarrollo
ENABLE_MOCK=true
NODE_ENV=production
npm start
```

### 3. Testing de Integración
```bash
# Deshabilitar mocks para testing real
ENABLE_MOCK=false
NODE_ENV=production
npm start
```

## 📊 Ventajas del AI Mock

✅ **Desarrollo Rápido** - Sin esperas de procesamiento real  
✅ **Costo Cero** - Sin cuotas de Replicate API  
✅ **Testing Offline** - Funciona sin conexión a servicios externos  
✅ **Respuestas Predecibles** - Mismos resultados para testing  
✅ **Desarrollo Iterativo** - Prueba rápida de UI/UX  
✅ **Control Total** - Activa/desactiva por variable de entorno  

## 🔧 Personalización de Mocks

### Agregar Nuevos Stickers Mock

Modifica `src/controllers/ai.controller.js`:

```javascript
const mockResponses = [
  // Stickers existentes...
  
  // Agregar nuevos stickers
  {
    stickerUrl: "https://animatedsticker.com/aistickers/custom-mock-sticker.png",
    replicateId: "mock_replicate_id_custom",
    web: "https://replicate.com/mock/sticker/custom"
  },
  {
    stickerUrl: "https://animatedsticker.com/aistickers/another-mock.jpg",
    replicateId: "mock_replicate_id_another",
    web: "https://replicate.com/mock/sticker/another"
  }
];
```

### Agregar Nuevos Videos Mock

```javascript
const mockVideoResponses = [
  // Videos existentes...
  
  // Agregar nuevos videos
  "https://animatedsticker.com/aistickers/custom-mock-video.mp4",
  "https://animatedsticker.com/aistickers/another-mock-video.mp4"
];
```

### Mock Basado en Prompt

```javascript
// Mock basado en contenido del prompt
let mockResponse;
if (prompt.toLowerCase().includes('christmas')) {
  mockResponse = mockResponses[0]; // Christmas sticker
} else if (prompt.toLowerCase().includes('birthday')) {
  mockResponse = mockResponses[1]; // Birthday sticker
} else {
  mockResponse = mockResponses[Math.floor(Math.random() * mockResponses.length)];
}
```

## 🧪 Testing Automatizado

### Unit Tests

```javascript
describe('AI Controller Mock', () => {
  beforeEach(() => {
    process.env.ENABLE_MOCK = 'true';
  });

  test('should return mock sticker response', async () => {
    const mockFile = { filename: 'test.jpg' };
    const req = { file: mockFile, body: { prompt: 'test' } };
    const res = { json: jest.fn() };

    await AIController.processImage(req, res);

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        stickerUrl: expect.stringContaining('animatedsticker.com'),
        replicateId: expect.stringContaining('mock_replicate_id'),
        web: expect.stringContaining('replicate.com')
      })
    );
  });
});
```

### Integration Tests

```javascript
test('full AI workflow with mocks', async () => {
  // 1. Login con mock
  const loginResponse = await request(app)
    .post('/api/v1/auth/google')
    .send({ idToken: 'mock_google_token' });

  const { paymentToken } = loginResponse.body;

  // 2. Procesar imagen con mock
  const processResponse = await request(app)
    .post('/process-image')
    .set('Authorization', `Bearer ${paymentToken}`)
    .attach('image', 'test/fixtures/test-image.jpg')
    .field('prompt', 'Christmas sticker');

  expect(processResponse.body).toHaveProperty('stickerUrl');
  expect(processResponse.body.stickerUrl).toContain('animatedsticker.com');
});
```

## 🔍 Debugging y Troubleshooting

### Logs del Mock

El sistema genera logs detallados:

```bash
# Iniciar con logs de debug
DEBUG=ai:* npm start

# Ver logs específicos de mocks
DEBUG=ai:mock npm start
```

### Problemas Comunes

**1. Mock no se activa:**
```
# Verificar variables de entorno
echo $ENABLE_MOCK_RESPONSES
echo $NODE_ENV
```

**2. Respuesta real en lugar de mock:**
```bash
# Asegurarse que la variable esté configurada
export ENABLE_MOCK_RESPONSES=true
npm restart
```

**3. Archivos temporales no se eliminan:**
- Verificar que `deleteUrl()` funcione correctamente
- Revisar permisos del sistema de archivos

## 📈 Métricas de Mock

El sistema puede incluir métricas:

- **Mocks generados:** Conteo de respuestas mock
- **Tipos de stickers:** Distribución por categorías
- **Tiempo de respuesta:** Métricas de rendimiento
- **Errores simulados:** Different error scenarios

## 🎉 Integración con otros Mocks

El AI Mock funciona perfectamente con el mock unificado del sistema:

```bash
# Activar todos los mocks para desarrollo completo
ENABLE_MOCK=true      # Mock de Google Sign-In + AI (stickers/videos)
NODE_ENV=development   # Habilita todos los mocks
```

**Flujo completo mock:**
1. **Login con Google Mock** → Usuario autenticado
2. **Procesar Sticker Mock** → Sticker generado
3. **Convertir a Video Mock** → Video animado
4. **Comprar con PaymentCore** → Transacción simulada

**¡Todo el ecosistema funciona sin dependencias externas!** 🚀
