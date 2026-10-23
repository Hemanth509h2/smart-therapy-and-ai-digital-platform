# =============================================================================
# STAAD backend - Docker image
# =============================================================================
#
# What this is:
#   The backend API (Next.js API routes + Prisma), started by server.js.
#   It listens on port 4000.
#
# How to build (run inside the backend/ folder):
#   docker build -t staad-backend .
#
# How to run:
#   docker run -p 4000:4000 -v "$PWD/.env:/app/.env:ro" staad-backend
#
#   -p 4000:4000          makes the API reachable at http://localhost:4000
#   -v .env:/app/.env:ro  gives the container your settings (read-only)
#
# Where the settings come from:
#   Everything (DATABASE_URL, FIREBASE_*, LIVEKIT_*, API keys, ...) is read from
#   the mounted .env file when the container starts. Nothing secret is copied
#   into the image, so the same image works with any .env.
#
# Database schema changes:
#   Run `npx prisma db push` (HIPAA database) and
#   `npx prisma db push --schema prisma/app/schema.prisma` (app database)
#   from your own machine, inside backend/.
#   The final image does not contain the Prisma command-line tool.
#
# The build has two stages:
#   Stage 1 "build"  installs everything and compiles the app.
#   Stage 2 (final)  copies only what is needed to run it, so the image is smaller.
# =============================================================================


# -----------------------------------------------------------------------------
# Stage 1: build the app
# -----------------------------------------------------------------------------

# Start from the official Node.js image (same version as local development).
FROM node:24.21.0-bookworm-slim AS build

# Prisma's database engine needs OpenSSL, and CA certificates to connect to the
# database over TLS (for example Neon).
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/*

# All following commands run inside /app.
WORKDIR /app

# Do not send anonymous usage data to Next.js during the build.
ENV NEXT_TELEMETRY_DISABLED=1

# Copy only the dependency list first. Docker caches this step, so dependencies
# are reinstalled only when package.json or package-lock.json change.
COPY package.json package-lock.json ./

# The install runs `prisma generate` afterwards, which needs the Prisma schema.
COPY prisma ./prisma

# Install the exact versions from package-lock.json (dev tools included,
# because they are needed to build).
RUN npm ci

# Now copy the rest of the source code (.env is NOT copied: it holds secrets).
COPY . .

# Compile the app (runs `prisma generate` and `next build`).
RUN npm run build

# Remove the dev-only packages (TypeScript, ESLint, firebase-tools, ...).
# The generated Prisma client is kept.
RUN npm prune --omit=dev


# -----------------------------------------------------------------------------
# Stage 2: the image that actually runs
# -----------------------------------------------------------------------------

# Start again from a clean Node.js image.
FROM node:24.21.0-bookworm-slim

# Same system packages as above: Prisma needs them at runtime too.
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Run in production mode on port 4000.
ENV NODE_ENV=production
ENV PORT=4000
ENV NEXT_TELEMETRY_DISABLED=1

# Copy only what is needed to run, from the build stage. The files are owned by
# the "node" user so the app can run without root.
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/.next ./.next
COPY --from=build --chown=node:node /app/package.json ./package.json
COPY --from=build --chown=node:node /app/server.js ./server.js
COPY --from=build --chown=node:node /app/prisma ./prisma

# Do not run as root.
USER node

# The port the API listens on.
EXPOSE 4000

# Docker checks every 30 seconds that the server still answers HTTP requests.
# Any answer counts as healthy (the API has no dedicated health route).
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:4000/').then(() => process.exit(0), () => process.exit(1))"

# Start the server in production mode.
CMD ["node", "server.js", "--prod"]
