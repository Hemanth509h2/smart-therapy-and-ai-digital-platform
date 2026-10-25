# =============================================================================
# STAAD frontend - Docker image
# =============================================================================
#
# What this is:
#   The website (Next.js). It listens on port 3000.
#
# How to build (run inside the frontend/ folder):
#   docker build -t staad-frontend .
#
# How to run:
#   docker run -p 3000:3000 staad-frontend
#
#   -p 3000:3000   makes the site reachable at http://localhost:3000
#
# Where the settings come from:
#   frontend/.env is used while BUILDING. All its values are NEXT_PUBLIC_*,
#   which Next.js writes into the JavaScript sent to the browser, so they are
#   public anyway and safe to include. To change one (for example
#   NEXT_PUBLIC_API_URL), edit .env and build the image again.
#   Nothing else is needed when the container runs.
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

# Optional: the public addresses the browser uses. When passed with
# --build-arg (docker-compose.yml does this on the cloud server), they replace
# the values in .env, so .env can keep its localhost addresses for development.
#   NEXT_PUBLIC_API_URL        backend API, e.g. https://app.example.com
#   NEXT_PUBLIC_STT_RELAY_URL  speech-to-text relay, e.g. https://app.example.com
ARG NEXT_PUBLIC_API_URL
ARG NEXT_PUBLIC_STT_RELAY_URL

# Copy only the dependency list first. Docker caches this step, so dependencies
# are reinstalled only when package.json or package-lock.json change.
COPY package.json package-lock.json ./

# Install the exact versions from package-lock.json. The downloaded packages
# are kept in a build cache (not in the image), so the next build only
# downloads what changed.
RUN --mount=type=cache,id=npm,target=/root/.npm \
    npm ci --prefer-offline --no-audit --no-fund

# Now copy the rest of the source code (including .env).
COPY . .

# Stop early with a clear message if .env is missing. Without it the build
# fails later with many confusing Firebase errors.
RUN if [ ! -f .env ]; then \
      echo "frontend/.env is missing: copy .env.example to .env and fill it in." >&2; \
      exit 1; \
    fi

# Compile the site. This also downloads the MediaPipe face model into
# public/mediapipe, so the build needs internet access.
# Next.js keeps its compile cache in a build cache (not in the image), so the
# next build only recompiles the files that changed.
RUN --mount=type=cache,id=frontend-next-cache,target=/app/.next/cache \
    npm run build


# -----------------------------------------------------------------------------
# Stage 2: the image that actually runs
# -----------------------------------------------------------------------------

# Start again from a clean Node.js image.
FROM node:24.21.0-bookworm-slim

WORKDIR /app

# Run in production mode on port 3000, reachable from outside the container.
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
ENV NEXT_TELEMETRY_DISABLED=1

# Copy the standalone server, the static files (JS, CSS) and the public folder
# (images, MediaPipe model). Files are owned by the "node" user.
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
COPY --from=build --chown=node:node /app/public ./public

# Do not run as root.
USER node

# The port the site listens on.
EXPOSE 3000

# Docker checks every 30 seconds that the home page still loads.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/').then(r => process.exit(r.status < 500 ? 0 : 1), () => process.exit(1))"

# Start the standalone Next.js server.
CMD ["node", "server.js"]
