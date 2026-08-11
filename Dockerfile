# syntax=docker/dockerfile:1
FROM node:24-bookworm-slim

WORKDIR /app

# Install dependencies first (better layer caching)
RUN apt-get update \
    && apt-get install -y --no-install-recommends openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
COPY prisma ./prisma

RUN npm ci --omit=dev \
    && ./node_modules/.bin/prisma generate \
    && npm cache clean --force

# Copy runtime files (see .dockerignore for exclusions).
# data/styles.json is the only data file allowed into the image; user data,
# uploads, backups and local runtime state are excluded by .dockerignore.
COPY --chown=node:node . .

# Ensure uploads dir exists before ownership/volume attach
RUN mkdir -p /app/data/uploads

# Ownership for non-root execution
RUN chown -R node:node /app/data

USER node

EXPOSE 2002

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:2002/health/ready').then(r=>{process.exit(r.ok?0:1)}).catch(()=>process.exit(1))"

STOPSIGNAL SIGTERM

CMD ["node", "index.js"]
