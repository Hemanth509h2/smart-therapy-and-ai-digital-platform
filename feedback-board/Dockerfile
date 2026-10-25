# =============================================================================
# STAAD feedback board - Docker image
# =============================================================================
#
# What this is:
#   The anonymous feedback board (Next.js). It listens on port 3100.
#   It needs its own PostgreSQL database (see docker-compose.yml in the repo root).
#
# How to build (run inside the feedback-board/ folder):
#   docker build -t staad-feedback .
#
#   Optional public values, compiled into the page:
#   docker build -t staad-feedback \
#     --build-arg NEXT_PUBLIC_PUBLIC_URL=https://feedback.example.com \
#     --build-arg NEXT_PUBLIC_TURNSTILE_SITE_KEY=... \
#     .
#
# How to run:
#   docker run -p 3100:3100 --env-file .env staad-feedback
#
# Create the database tables (once):
#   docker run --rm --env-file .env staad-feedback node scripts/init-db.mjs
#   (docker-compose.yml does this automatically for its own database.)
#
# Where the settings come from:
#   DATABASE_URL, HMAC_SECRET, ADMIN_PASSWORD, TURNSTILE_SECRET_KEY, BLOCKLIST
#   and AUTO_HIDE_REPORTS are read when the container starts. These are secrets,
#   so they are never copied into the image.
#
# The build has two stages:
#   Stage 1 "build"  installs everything and compiles the site.
#   Stage 2 (final)  keeps only the small standalone server Next.js produces.
# =============================================================================


# -----------------------------------------------------------------------------
# Stage 1: build the site
# -----------------------------------------------------------------------------

# Start from the official Node.js image (same version as local development).
FROM node:24.21.0-bookworm-slim AS build

# All following commands run inside /app.
WORKDIR /app

# Do not send anonymous usage data to Next.js during the build.
ENV NEXT_TELEMETRY_DISABLED=1

# Ask Next.js for a "standalone" build: a small server.js with only the files
# it needs. next.config.mjs only turns this on when this variable is set.
ENV NEXT_OUTPUT=standalone

# Optional public values. They are empty unless passed with --build-arg.
#   NEXT_PUBLIC_PUBLIC_URL          address shown in the /present QR code
#   NEXT_PUBLIC_TURNSTILE_SITE_KEY  Cloudflare CAPTCHA (off when empty)
ARG NEXT_PUBLIC_PUBLIC_URL
ARG NEXT_PUBLIC_TURNSTILE_SITE_KEY

# Copy only the dependency list first. Docker caches this step, so dependencies
# are reinstalled only when package.json or package-lock.json change.
COPY package.json package-lock.json ./

# Install the exact versions from package-lock.json. The downloaded packages
# are kept in a build cache (not in the image), so the next build only
# downloads what changed.
RUN --mount=type=cache,id=npm,target=/root/.npm \
    npm ci --prefer-offline --no-audit --no-fund

# Now copy the rest of the source code (.env is NOT copied: it holds secrets).
COPY . .

# Compile the site. Next.js keeps its compile cache in a build cache (not in
# the image), so the next build only recompiles the files that changed.
RUN --mount=type=cache,id=feedback-next-cache,target=/app/.next/cache \
    npm run build


# -----------------------------------------------------------------------------
# Stage 2: the image that actually runs
# -----------------------------------------------------------------------------

# Start again from a clean Node.js image.
FROM node:24.21.0-bookworm-slim

WORKDIR /app

# Run in production mode on port 3100, reachable from outside the container.
ENV NODE_ENV=production
ENV PORT=3100
ENV HOSTNAME=0.0.0.0
ENV NEXT_TELEMETRY_DISABLED=1

# Copy the standalone server and the static files (JS, CSS).
# Files are owned by the "node" user.
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static

# Copy the database schema and the script that applies it
# (`node scripts/init-db.mjs`).
COPY --from=build --chown=node:node /app/schema.sql ./schema.sql
COPY --from=build --chown=node:node /app/scripts ./scripts

# Do not run as root.
USER node

# The port the site listens on.
EXPOSE 3100

# Docker checks every 30 seconds that the home page still loads.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3100/').then(r => process.exit(r.status < 500 ? 0 : 1), () => process.exit(1))"

# Start the standalone Next.js server.
CMD ["node", "server.js"]
