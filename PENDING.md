# Pendientes

## 1. Vincular Service Account a Google Play Console
La verificación real de compras está implementada pero la service account necesita permisos en Play Console.

**Pasos:**
1. Ir a Play Console → nivel de cuenta → **Ajustes → Acceso a la API**
   - Este menú aparece una vez que haya al menos una app con versión publicada (pruebas internas cuenta)
2. En la sección "Cuentas de servicio" aparecerá `aistickers-payments@...`
3. Pulsar **"Conceder acceso"** → marcar **"Ver datos financieros, pedidos y respuestas de la encuesta de cancelación"**
4. Guardar

Sin este paso el backend devuelve 403 al llamar a la Google Play Developer API.

## 2. Pagos pendientes (RTDN)
Cuando un pago queda en estado **pendiente** (ej: pago contra reembolso), el backend lo rechaza con un mensaje al usuario.
Para completar el flujo, hay que implementar **Real-time Developer Notifications (RTDN)** via Google Cloud Pub/Sub:
- Google avisa al backend cuando un pago pendiente se confirma o cancela
- El backend suma el balance en ese momento

**Requiere:** Play Console con API access configurado (ver punto 1) + un topic de Pub/Sub en Google Cloud.
