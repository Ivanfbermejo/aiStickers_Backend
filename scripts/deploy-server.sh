#!/usr/bin/env bash

set -Eeuo pipefail

readonly SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
readonly REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd -P)"
readonly COMPOSE_FILE="${REPO_ROOT}/compose.dev.yml"
readonly SERVER_COMPOSE_FILE="${REPO_ROOT}/compose.server.yml"
readonly ENV_FILE="${REPO_ROOT}/.env.docker"
readonly IMAGE="aistickers-backend:dev"
readonly ROLLBACK_IMAGE="aistickers-backend:rollback"
readonly DB_VOLUME="aistickers_dev_db"

BACKEND_HOST_PORT="${BACKEND_HOST_PORT:-}"
HEALTH_TIMEOUT_SECONDS="${HEALTH_TIMEOUT_SECONDS:-120}"
SKIP_JSON_IMPORT=false
RESET_UNINITIALIZED_DB=false
ROLLBACK_AVAILABLE=false

usage() {
  cat <<'USAGE'
Construye y despliega aiStickers Backend en el servidor de desarrollo.

Uso:
  ./scripts/deploy-server.sh [opciones]

Opciones:
  --host-port PORT     Puerto local detrás de Apache (por defecto: 2002).
  --health-timeout SEC Tiempo máximo para readiness (por defecto: 120).
  --skip-json-import   No intenta importar los datos JSON existentes a PostgreSQL.
  --reset-uninitialized-db
                       Recrea el volumen PostgreSQL solo si no contiene PG_VERSION.
                       Úsalo para recuperar una inicialización fallida; nunca borra
                       una base PostgreSQL ya inicializada.
  -h, --help           Muestra esta ayuda.

El script conserva los volúmenes, crea backups, aplica migraciones Prisma,
arranca db/redis/backend/worker y valida /health/ready. Nunca usa down -v.
USAGE
}

die() {
  printf 'Error: %s\n' "$*" >&2
  exit 1
}

read_env_value() {
  local key="$1"
  awk -v wanted="$key" '
    /^[[:space:]]*#/ { next }
    index($0, "=") == 0 { next }
    {
      current = substr($0, 1, index($0, "=") - 1)
      gsub(/^[[:space:]]+|[[:space:]]+$/, "", current)
      if (current == wanted) {
        value = substr($0, index($0, "=") + 1)
        gsub(/^[[:space:]]+|[[:space:]]+$/, "", value)
        print value
        exit
      }
    }
  ' "$ENV_FILE"
}

while (($# > 0)); do
  case "$1" in
    --host-port)
      (($# >= 2)) || die "falta el valor de --host-port"
      BACKEND_HOST_PORT="$2"
      shift 2
      ;;
    --health-timeout)
      (($# >= 2)) || die "falta el valor de --health-timeout"
      HEALTH_TIMEOUT_SECONDS="$2"
      shift 2
      ;;
    --skip-json-import)
      SKIP_JSON_IMPORT=true
      shift
      ;;
    --reset-uninitialized-db)
      RESET_UNINITIALIZED_DB=true
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      die "opción desconocida: $1"
      ;;
  esac
done

command -v docker >/dev/null 2>&1 || die "docker no está instalado"
command -v curl >/dev/null 2>&1 || die "curl no está instalado"
[[ -f "$COMPOSE_FILE" ]] || die "falta compose.dev.yml"
[[ -f "$SERVER_COMPOSE_FILE" ]] || die "falta compose.server.yml"
[[ -f "$ENV_FILE" ]] || die "falta .env.docker; créalo desde .env.docker.example"

docker compose version >/dev/null 2>&1 \
  || die "docker compose no está disponible"

BACKEND_HOST_PORT="${BACKEND_HOST_PORT:-2002}"

[[ "$BACKEND_HOST_PORT" =~ ^[0-9]+$ ]] \
  || die "BACKEND_HOST_PORT debe ser numérico"
((BACKEND_HOST_PORT >= 1 && BACKEND_HOST_PORT <= 65535)) \
  || die "BACKEND_HOST_PORT debe estar entre 1 y 65535"
[[ "$HEALTH_TIMEOUT_SECONDS" =~ ^[0-9]+$ ]] \
  || die "HEALTH_TIMEOUT_SECONDS debe ser numérico"
((HEALTH_TIMEOUT_SECONDS >= 10 && HEALTH_TIMEOUT_SECONDS <= 900)) \
  || die "HEALTH_TIMEOUT_SECONDS debe estar entre 10 y 900"

for key in POSTGRES_USER POSTGRES_PASSWORD POSTGRES_DB DATABASE_URL JWT_SECRET CLIENT_SECRET; do
  value="$(read_env_value "$key")"
  [[ -n "$value" ]] || die "falta ${key} en .env.docker"
  case "$value" in
    *CHANGE_ME*|your-*-here)
      die "${key} todavía contiene un valor de ejemplo"
      ;;
  esac
done

export BACKEND_HOST_PORT
compose=(
  docker compose
  --env-file "$ENV_FILE"
  -f "$COMPOSE_FILE"
  -f "$SERVER_COMPOSE_FILE"
)

on_error() {
  local exit_code=$?
  printf '\nEl despliegue falló (código %s). Estado y últimos logs:\n' "$exit_code" >&2
  "${compose[@]}" ps >&2 || true
  "${compose[@]}" logs --tail 120 backend worker db redis >&2 || true
  if [[ "$ROLLBACK_AVAILABLE" == true ]]; then
    printf '\nIntentando restaurar la imagen anterior...\n' >&2
    docker tag "$ROLLBACK_IMAGE" "$IMAGE" >&2 || true
    "${compose[@]}" up -d --no-build backend worker >&2 || true
  fi
  exit "$exit_code"
}
trap on_error ERR

cd "$REPO_ROOT"
printf 'Validando Compose y configuración...\n'
"${compose[@]}" config --quiet

if [[ "$RESET_UNINITIALIZED_DB" == true ]] \
  && docker volume inspect "$DB_VOLUME" >/dev/null 2>&1; then
  printf 'Comprobando que %s nunca fue inicializado...\n' "$DB_VOLUME"
  if docker run --rm \
    --volume "${DB_VOLUME}:/data:ro" \
    postgres:16-alpine3.22 \
    test -f /data/PG_VERSION; then
    die "${DB_VOLUME} contiene PG_VERSION; se rechaza el reset para proteger la base existente"
  fi

  printf 'El volumen no contiene PG_VERSION. Recreándolo por solicitud explícita...\n'
  "${compose[@]}" stop db >/dev/null 2>&1 || true
  "${compose[@]}" rm --force --stop db >/dev/null 2>&1 || true
  docker volume rm "$DB_VOLUME" >/dev/null
  printf 'Volumen PostgreSQL no inicializado recreable eliminado; Compose creará uno nuevo.\n'
fi

if docker image inspect "$IMAGE" >/dev/null 2>&1; then
  docker tag "$IMAGE" "$ROLLBACK_IMAGE"
  ROLLBACK_AVAILABLE=true
  printf 'Imagen actual guardada como %s.\n' "$ROLLBACK_IMAGE"
fi

printf 'Construyendo %s antes de detener el servicio actual...\n' "$IMAGE"
if docker buildx version >/dev/null 2>&1; then
  docker build --pull --tag "$IMAGE" .
else
  DOCKER_BUILDKIT=0 docker build --pull --tag "$IMAGE" .
fi

printf 'Deteniendo backend y worker; los volúmenes se conservan...\n'
"${compose[@]}" stop backend worker >/dev/null 2>&1 || true

printf 'Arrancando PostgreSQL y Redis...\n'
"${compose[@]}" up -d --no-build db redis

printf 'Esperando a PostgreSQL y Redis...\n'
dependency_deadline=$((SECONDS + 90))
until "${compose[@]}" exec -T db sh -c 'pg_isready -U "$POSTGRES_USER" -d "$POSTGRES_DB"' >/dev/null 2>&1 \
  && "${compose[@]}" exec -T redis redis-cli ping 2>/dev/null | grep -q '^PONG$'; do
  ((SECONDS < dependency_deadline)) || die "PostgreSQL o Redis no quedaron disponibles en 90 segundos"
  sleep 2
done

timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
backup_dir="${REPO_ROOT}/backups/predeploy-${timestamp}"
mkdir -p "$backup_dir"

printf 'Creando backup previo en %s...\n' "$backup_dir"
"${compose[@]}" exec -T db sh -c \
  'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' >"${backup_dir}/db.dump"
docker run --rm --user 0:0 \
  --volume aistickers_dev_data:/app/data:ro \
  --volume "${backup_dir}:/backup:Z" \
  "$IMAGE" \
  sh -c 'tar -C /app/data -czf /backup/data.tar.gz .'

printf 'Aplicando migraciones Prisma...\n'
"${compose[@]}" run --rm --no-deps backend npx prisma migrate deploy

if [[ "$SKIP_JSON_IMPORT" == false ]]; then
  json_files=(
    users.json balances.json transactions.json purchases.json
    stickers.json packages.json generation-jobs.json sessions.json
  )
  json_count=0
  for json_file in "${json_files[@]}"; do
    if docker run --rm \
      --volume aistickers_dev_data:/app/data:ro \
      "$IMAGE" test -f "/app/data/${json_file}"; then
      ((json_count += 1))
    fi
  done

  if ((json_count == ${#json_files[@]})); then
    printf 'Validando importación JSON a PostgreSQL (dry-run)...\n'
    "${compose[@]}" run --rm --no-deps backend \
      node scripts/import-json-to-postgres.js --source /app/data
    printf 'Importando JSON a PostgreSQL de forma idempotente...\n'
    "${compose[@]}" run --rm --no-deps backend \
      node scripts/import-json-to-postgres.js --source /app/data --commit
  elif ((json_count > 0)); then
    die "el volumen contiene solo ${json_count}/${#json_files[@]} archivos JSON requeridos; se cancela la importación"
  else
    printf 'No hay dataset JSON previo; se omite la importación.\n'
  fi
fi

printf 'Arrancando backend y worker en el puerto %s...\n' "$BACKEND_HOST_PORT"
"${compose[@]}" up -d --no-build backend worker

health_url="http://127.0.0.1:${BACKEND_HOST_PORT}/health/ready"
health_deadline=$((SECONDS + HEALTH_TIMEOUT_SECONDS))
until curl --fail --silent --show-error "$health_url" >/dev/null 2>&1; do
  ((SECONDS < health_deadline)) \
    || die "readiness no respondió correctamente en ${HEALTH_TIMEOUT_SECONDS} segundos"
  sleep 2
done

trap - ERR
printf '\nDespliegue completado correctamente.\n'
"${compose[@]}" ps
printf 'Readiness: %s\n' "$health_url"
printf 'Logs activos: docker compose --env-file .env.docker -f compose.dev.yml -f compose.server.yml logs -f backend worker\n'
