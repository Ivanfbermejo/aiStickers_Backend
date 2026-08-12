#!/usr/bin/env bash

set -Eeuo pipefail

readonly SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
readonly REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd -P)"

DEPLOY_HOST="${DEPLOY_HOST:-}"
DEPLOY_USER="${DEPLOY_USER:-root}"
DEPLOY_PORT="${DEPLOY_PORT:-22}"
DEPLOY_PATH="${DEPLOY_PATH:-/var/www/aiStickers_Backend}"
DRY_RUN=false

usage() {
  cat <<'USAGE'
Sincroniza los archivos necesarios del backend con un servidor por SSH.

Uso:
  ./scripts/sync-server.sh --host HOST [opciones]

Opciones:
  --host HOST       IP o dominio del servidor (obligatorio).
  --user USER       Usuario SSH (por defecto: root).
  --port PORT       Puerto SSH (por defecto: 22).
  --path PATH       Directorio remoto
                    (por defecto: /var/www/aiStickers_Backend).
  --dry-run         Muestra qué cambiaría sin transferir archivos.
  -h, --help        Muestra esta ayuda.

También se pueden usar DEPLOY_HOST, DEPLOY_USER, DEPLOY_PORT y DEPLOY_PATH.

Ejemplos:
  ./scripts/sync-server.sh --host 203.0.113.10 --dry-run
  ./scripts/sync-server.sh --host backend.example.com

El script NO copia ni elimina .env.docker, datos, uploads, backups, volúmenes
Docker, node_modules o el repositorio .git remoto. Tampoco reinicia servicios.
USAGE
}

die() {
  printf 'Error: %s\n' "$*" >&2
  exit 1
}

while (($# > 0)); do
  case "$1" in
    --host)
      (($# >= 2)) || die "falta el valor de --host"
      DEPLOY_HOST="$2"
      shift 2
      ;;
    --user)
      (($# >= 2)) || die "falta el valor de --user"
      DEPLOY_USER="$2"
      shift 2
      ;;
    --port)
      (($# >= 2)) || die "falta el valor de --port"
      DEPLOY_PORT="$2"
      shift 2
      ;;
    --path)
      (($# >= 2)) || die "falta el valor de --path"
      DEPLOY_PATH="$2"
      shift 2
      ;;
    --dry-run)
      DRY_RUN=true
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

[[ -n "$DEPLOY_HOST" ]] || die "debes indicar --host HOST o DEPLOY_HOST"
[[ "$DEPLOY_HOST" =~ ^[A-Za-z0-9._-]+$ ]] || die "HOST contiene caracteres no permitidos"
[[ "$DEPLOY_USER" =~ ^[A-Za-z_][A-Za-z0-9_-]*$ ]] || die "USER no es válido"
[[ "$DEPLOY_PORT" =~ ^[0-9]+$ ]] || die "PORT debe ser numérico"
((DEPLOY_PORT >= 1 && DEPLOY_PORT <= 65535)) || die "PORT debe estar entre 1 y 65535"
[[ "$DEPLOY_PATH" =~ ^/[A-Za-z0-9._/-]+$ ]] || die "PATH debe ser absoluto y no contener espacios"
[[ "$DEPLOY_PATH" != *'/../'* && "$DEPLOY_PATH" != */.. ]] \
  || die "PATH no puede contener componentes .."
[[ "$DEPLOY_PATH" != *'/./'* && "$DEPLOY_PATH" != */. ]] \
  || die "PATH no puede contener componentes ."

# Avoid harmless but confusing double slashes in the remote destination.
while [[ "$DEPLOY_PATH" != / && "$DEPLOY_PATH" == */ ]]; do
  DEPLOY_PATH="${DEPLOY_PATH%/}"
done

case "$DEPLOY_PATH" in
  /|/var|/var/|/var/www|/var/www/)
    die "PATH es demasiado amplio para una sincronización segura"
    ;;
esac

command -v ssh >/dev/null 2>&1 || die "ssh no está instalado"
command -v rsync >/dev/null 2>&1 || die "rsync no está instalado"

required_local_files=(
  .dockerignore
  .env.docker.example
  Dockerfile
  compose.dev.yml
  compose.server.yml
  compose.production.example.yml
  data/styles.json
  index.js
  package-lock.json
  package.json
  prisma/schema.prisma
  scripts/production-preflight.js
  scripts/deploy-server.sh
  src/server.js
)

for file in "${required_local_files[@]}"; do
  [[ -f "${REPO_ROOT}/${file}" ]] || die "falta el archivo local requerido: ${file}"
done

readonly REMOTE="${DEPLOY_USER}@${DEPLOY_HOST}"
ssh_args=(-p "$DEPLOY_PORT")

printf 'Origen:  %s\n' "$REPO_ROOT"
printf 'Destino: %s:%s\n' "$REMOTE" "$DEPLOY_PATH"
if [[ "$DRY_RUN" == true ]]; then
  printf 'Modo:    simulación (no se copiará nada)\n'
else
  printf 'Modo:    sincronización real\n'
fi

# DEPLOY_PATH has already been constrained to a shell-safe character set.
ssh "${ssh_args[@]}" "$REMOTE" "test -d '${DEPLOY_PATH}'" \
  || die "el directorio remoto no existe: ${DEPLOY_PATH}"

rsync_ssh="ssh -p ${DEPLOY_PORT}"
rsync_args=(
  --archive
  --compress
  --itemize-changes
  --human-readable
  # Compatible with the rsync 2.6.9 bundled with macOS. Deletion only applies
  # to included runtime trees; excluded server secrets and data are protected.
  --delete-after
  --filter='+ /.dockerignore'
  --filter='+ /.env.docker.example'
  --filter='+ /Dockerfile'
  --filter='+ /compose.dev.yml'
  --filter='+ /compose.server.yml'
  --filter='+ /compose.production.example.yml'
  --filter='+ /index.js'
  --filter='+ /package.json'
  --filter='+ /package-lock.json'
  --filter='+ /data/'
  --filter='+ /data/styles.json'
  --filter='- /data/***'
  --filter='+ /prisma/***'
  --filter='+ /scripts/***'
  --filter='+ /src/***'
  --filter='- *'
)

if [[ "$DRY_RUN" == true ]]; then
  rsync_args+=(--dry-run)
fi

rsync "${rsync_args[@]}" -e "$rsync_ssh" "${REPO_ROOT}/" "${REMOTE}:${DEPLOY_PATH}/"

if [[ "$DRY_RUN" == true ]]; then
  printf '\nSimulación completada. Repite sin --dry-run para transferir.\n'
  exit 0
fi

ssh "${ssh_args[@]}" "$REMOTE" \
  "test -f '${DEPLOY_PATH}/Dockerfile' && test -f '${DEPLOY_PATH}/compose.dev.yml' && test -f '${DEPLOY_PATH}/compose.server.yml' && test -f '${DEPLOY_PATH}/package-lock.json' && test -f '${DEPLOY_PATH}/prisma/schema.prisma' && test -f '${DEPLOY_PATH}/scripts/deploy-server.sh' && test -f '${DEPLOY_PATH}/src/server.js'" \
  || die "la verificación remota posterior a la copia ha fallado"

printf '\nSincronización y verificación completadas. No se han reiniciado servicios.\n'
printf 'Para desplegar y arrancar todo en el servidor:\n'
printf '  ssh -p %s %s "cd %s && ./scripts/deploy-server.sh"\n' \
  "$DEPLOY_PORT" "$REMOTE" "$DEPLOY_PATH"
