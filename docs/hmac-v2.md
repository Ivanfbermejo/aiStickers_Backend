# HMAC v2 para Android

HMAC es una señal antiabuso del cliente móvil. No sustituye el JWT de usuario,
la autorización de ownership ni la verificación de Play Integrity/App Attest.

## Headers

Cada petición protegida incluye:

- `X-App-Id`
- `X-App-Hmac-Version: 2`
- `X-App-Timestamp` (epoch seconds, entero)
- `X-App-Nonce` (UUID)
- `X-App-Signature` (HMAC-SHA256 en hexadecimal, 64 caracteres)

El cliente calcula `bodyHash = SHA-256(rawBody)` sobre los bytes exactos del
JSON enviado. Para peticiones sin cuerpo se usa SHA-256 de una cadena vacía.

El material canónico v2 es:

```text
v2.{timestamp}.{nonce}.{METHOD}.{path-sin-query}.{bodyHash}
```

La firma es `HMAC-SHA256(CLIENT_SECRET, material-canónico)`. Los payloads de
generación deben usar el flujo de objetos de T07 y enviar JSON con `objectKey`
y `hash` del objeto privado; el servidor comprueba ambos contra storage y
ownership antes de crear el trabajo.

## Migración

El backend de desarrollo acepta temporalmente v1 (sin el prefijo `v2` y sin el
header de versión) para facilitar una actualización gradual de Android. La
producción rechaza v1 y cualquier multipart legado; antes del despliegue se
publica el cliente que envía v2 y JSON `objectKey` + `hash`. El multipart se
mantiene únicamente en development durante esa ventana y debe retirarse del
cliente Android antes del cambio a producción.

El nonce se registra con `SET NX EX SIG_WINDOW_SEC` en Redis. Repetirlo dentro
de la ventana devuelve 401; si Redis no está disponible, la petición se bloquea.

Los headers futuros `X-Integrity-Provider` y `X-Integrity-Token` se conservan
como interfaz para añadir Play Integrity/App Attest sin convertir HMAC en una
prueba de integridad del dispositivo.
