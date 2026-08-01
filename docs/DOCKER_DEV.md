# Docker de desarrollo — aiStickers Backend

Ejecuta el backend en un contenedor Node 24, en paralelo al proceso `npm start`
existente (Node 16), sin tocar el host y con datos totalmente aislados.

> ⚠️ **Nunca** compartas el `DATA_DIR` del contenedor con el proceso `npm start`
> original. El contenedor usa un volumen Docker separado (`aistickers_dev_data`),
> nunca la carpeta `data/` real del servidor.

> ⚠️ **Nunca** ejecutes `docker compose -f compose.dev.yml down -v` si quieres
> conservar los datos de prueba. El flag `-v` borra el volumen nombrado.

## Requisitos

```bash
docker --version
docker compose version
```

## 1. Configurar variables de entorno

En el servidor (no en tu máquina local, no lo pegues en tickets/chats):

```bash
cd /ruta/real/aiStickers_Backend
cp .env.docker.example .env.docker
chmod 600 .env.docker
# Edita .env.docker y rellena los valores reales
```

`docker compose config --quiet` se usa en los pasos siguientes en vez de
`config` a secas para no imprimir secretos en pantalla.

## 2. Build

```bash
docker compose -f compose.dev.yml config --quiet
docker compose -f compose.dev.yml build --pull
```

## 3. Arranque

```bash
docker compose -f compose.dev.yml up -d
docker compose -f compose.dev.yml ps
```

## 4. Healthcheck

```bash
curl --fail --silent http://127.0.0.1:22025/health
```

Debe responder `2xx` con un JSON `{ "status": "ok", ... }`.

## 5. Inspección de versión Node/npm

```bash
docker compose -f compose.dev.yml exec backend node --version
docker compose -f compose.dev.yml exec backend npm --version
```

`node --version` debe reportar `v24.x`.

## 6. Verificar usuario no-root

```bash
docker compose -f compose.dev.yml exec backend node -e "if (process.getuid && process.getuid() === 0) process.exit(1)"
```

Código de salida `0` significa que el proceso **no** corre como root.

## 7. Logs

```bash
docker compose -f compose.dev.yml logs --tail 200 backend
```

## 8. Reinicio y parada

```bash
# Reinicio (mantiene el volumen de datos)
docker compose -f compose.dev.yml restart backend

# Parada (mantiene el volumen de datos)
docker compose -f compose.dev.yml stop
```

## 9. Rollback

```bash
docker compose -f compose.dev.yml down
```

Esto detiene y elimina el contenedor, pero:

- No modifica Node 16 ni npm del host.
- No afecta al proceso `npm start` original.
- **No** borra el volumen `aistickers_dev_data` (no se usa `-v`).

## 10. Subdominio temporal (Nginx/Apache) apuntando a 127.0.0.1:22025

El backend firma las rutas con HMAC, por lo que el proxy **no debe añadir
ningún prefijo de path** — debe ser un passthrough 1:1 al puerto `22025`.

### Nginx

```nginx
server {
    listen 80;
    server_name dev-aistickers.tu-dominio.com;

    location / {
        proxy_pass http://127.0.0.1:22025;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

Luego añade TLS con tu método habitual (por ejemplo `certbot --nginx`).

### Apache

```apache
<VirtualHost *:80>
    ServerName dev-aistickers.tu-dominio.com

    ProxyPreserveHost On
    ProxyPass / http://127.0.0.1:22025/
    ProxyPassReverse / http://127.0.0.1:22025/
</VirtualHost>
```

Habilita los módulos necesarios si no están activos:

```bash
sudo a2enmod proxy proxy_http
sudo systemctl reload apache2
```

## Validación de flujo completo (después de exponer el subdominio)

1. Probar Google login desde el cliente apuntando al subdominio temporal.
2. Probar balance con datos ficticios del volumen nuevo.
3. Crear un job de IA de prueba y verificar persistencia después de:
   ```bash
   docker compose -f compose.dev.yml restart backend
   ```
4. Probar una exportación estática pequeña.
5. Confirmar que el proceso `npm start` original sigue respondiendo en su
   puerto (Node 16, sin cambios).

## Límites de recursos

Por defecto: 1 CPU, 1 GB RAM (ver `compose.dev.yml`). Si `sharp` falla por
memoria durante las pruebas, sube el límite a 2 GB en `compose.dev.yml`
(`mem_limit: 2g`) y documenta el cambio aquí.
