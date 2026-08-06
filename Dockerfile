# syntax=docker/dockerfile:1
FROM node:24-bookworm-slim

WORKDIR /app

# Install dependencies first (better layer caching)
COPY package.json package-lock.json ./
RUN npm ci --omit=dev \
    && npm cache clean --force

# Copy runtime files (see .dockerignore for exclusions).
# data/styles.json is included here so it seeds the named volume
# mounted at /app/data on first container start.
COPY . .

# Ensure uploads dir exists before ownership/volume attach
RUN mkdir -p /app/data/uploads

# Ownership for non-root execution
RUN chown -R node:node /app /app/data

USER node

EXPOSE 2002

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:2002/health').then(r=>{process.exit(r.ok?0:1)}).catch(()=>process.exit(1))"

CMD ["npm", "start"]
