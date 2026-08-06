# T07 — almacenamiento privado de assets

## Política de privacidad

- Producción exige `ASSET_STORAGE_DRIVER=s3`; `local` solo se acepta en desarrollo y tests.
- El bucket debe tener acceso público bloqueado. La aplicación no asigna ACL públicas; SSE-S3/KMS se activa explícitamente cuando el proveedor lo soporta (MinIO local no requiere KMS).
- La DB guarda `objectKey`, owner, SHA-256, bytes, MIME real y dimensiones; nunca guarda URLs permanentes ni URLs firmadas.
- Las lecturas requieren un JWT del propietario o una URL firmada de hasta 15 minutos (5 minutos por defecto).
- CORS del bucket debe limitarse a los orígenes reales y a `GET/HEAD`; nunca usar `*` en producción.

## Retención, borrado y coste

- Al borrar una entidad se registra primero una tarea local y solo se borra el objeto tras confirmar el cambio de DB. La tarea es idempotente y conserva fallos para que T08 la procese con una cola durable; T07 no implementa Redis/BullMQ.
- Conservar resultados referenciados mientras exista su entidad. Configurar lifecycle para abortar multipart incompletos tras 1 día y eliminar objetos temporales/no referenciados tras 30 días.
- Versionado queda desactivado por defecto para evitar multiplicar coste; si se activa, expirar versiones no actuales tras 7 días.
- Vigilar bytes almacenados, peticiones PUT/GET, egreso y objetos sin referencia. Alertar ante crecimiento semanal anómalo.

## MinIO local opcional

```bash
docker compose -f compose.dev.yml --profile object-storage up -d minio minio-init
```

Las credenciales de Compose son ficticias y locales. Para probar el backend contra MinIO, usar las variables comentadas en `.env.docker.example`. No reutilizarlas fuera de desarrollo.

## Migración de `/uploads`

```bash
# Sin escrituras (predeterminado)
npm run assets:migrate

# Copia, verifica hash y actualiza referencias; nunca borra el origen
npm run assets:migrate -- --apply
```

El object key de migración es determinista por propietario, ruta y hash. Repetir `--apply` verifica/reutiliza la copia existente, por lo que la operación es idempotente.

Los resultados `animated_sticker` e `img2vid` están desactivados de forma fail-closed hasta T12: no se envían al validador exclusivo de imágenes.
