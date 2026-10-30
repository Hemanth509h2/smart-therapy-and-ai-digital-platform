# =============================================================================
# STAAD backend (Express) - Docker image
# =============================================================================
#
# What this is:
#   The backend API (Express + Prisma), compiled to dist/ and started with
#   `node dist/server.js`. It listens on port 4000.
#
# How to build (run inside the backend-express/ folder):
#   docker build -t staad-backend-express .
#
# How to run:
#   docker run -p 4000:4000 --env-file .env staad-backend-express
#
# Everything (DATABASE_URL, FIREBASE_*, LIVEKIT_*, ...) comes from the
# environment at start-up. Nothing secret is copied into the image.
# Database schema changes are applied from your own machine; see the notes in
# ../backend/Dockerfile (never `db push` the app database).
# =============================================================================


# -----------------------------------------------------------------------------
# Stage 1: build the app
# -----------------------------------------------------------------------------
FROM node:24.21.0-bookworm-slim AS build

# Prisma's database engine needs OpenSSL, and CA certificates for TLS.
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Dependencies first so Docker caches them. The install runs `prisma
# generate`, which needs the Prisma schema.
COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN --mount=type=cache,id=npm,target=/root/.npm \
    npm ci --prefer-offline --no-audit --no-fund

# Compile TypeScript to dist/ (.env is NOT copied: it holds secrets).
COPY . .
RUN npm run build

# Remove the dev-only packages. The generated Prisma clients are kept.
RUN npm prune --omit=dev


# -----------------------------------------------------------------------------
# Stage 2: the image that actually runs
# -----------------------------------------------------------------------------
FROM node:24.21.0-bookworm-slim

RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=4000

COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build --chown=node:node /app/package.json ./package.json
COPY --from=build --chown=node:node /app/prisma ./prisma

USER node

EXPOSE 4000

# The root URL answers {"status":"ok"}.
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:4000/').then(r => process.exit(r.ok ? 0 : 1), () => process.exit(1))"

CMD ["node", "dist/server.js"]
