# T07 — almacenamiento privado de assets

## Política de privacidad

- Producción exige `ASSET_STORAGE_DRIVER=s3`; `local` solo se acepta en desarrollo y tests.
- El bucket debe tener acceso público bloqueado. La aplicación no asigna ACL públicas y cifra cada objeto con SSE-S3 (`AES256`).
- La DB guarda `objectKey`, owner, SHA-256, bytes, MIME real y dimensiones; nunca guarda URLs permanentes ni URLs firmadas.
- Las lecturas requieren un JWT del propietario o una URL firmada de hasta 15 minutos (5 minutos por defecto).
- CORS del bucket debe limitarse a los orígenes reales y a `GET/HEAD`; nunca usar `*` en producción.

## Retención, borrado y coste

- Al borrar stickers o exports, el borrado del objeto es idempotente. T08 añadirá la cola durable; T07 no la implementa.
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
