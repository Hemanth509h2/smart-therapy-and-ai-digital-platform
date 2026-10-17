# STAAD frontend (Next.js), port 3000. Built as a standalone server.
#
#   docker build -t staad-frontend \
#     --build-arg NEXT_PUBLIC_API_URL=https://api.example.com \
#     --build-arg NEXT_PUBLIC_STT_RELAY_URL=https://stt.example.com \
#     --build-arg NEXT_PUBLIC_FIREBASE_API_KEY=... \
#     .
#   docker run -p 3000:3000 staad-frontend
#
# Every NEXT_PUBLIC_* value is baked into the browser bundle at build time, so
# pass them as build args (changing one means rebuilding). Instead of
# NEXT_PUBLIC_API_URL you can set BACKEND_URL to proxy /api/* through this
# server (see next.config.mjs); it is also read at build time.

FROM node:24.21.0-bookworm-slim AS base
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

# ---- Dependencies ----
FROM base AS deps
COPY package.json package-lock.json ./
RUN npm ci

# ---- Build ----
FROM base AS build
ARG NEXT_PUBLIC_API_URL
ARG BACKEND_URL
ARG NEXT_PUBLIC_LIVEKIT_URL
ARG NEXT_PUBLIC_STT_RELAY_URL
ARG NEXT_PUBLIC_STT_TEST_MODE=false
ARG NEXT_PUBLIC_FIREBASE_API_KEY
ARG NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN
ARG NEXT_PUBLIC_FIREBASE_DATABASE_URL
ARG NEXT_PUBLIC_FIREBASE_PROJECT_ID
ARG NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET
ARG NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID
ARG NEXT_PUBLIC_FIREBASE_APP_ID
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL \
    BACKEND_URL=$BACKEND_URL \
    NEXT_PUBLIC_LIVEKIT_URL=$NEXT_PUBLIC_LIVEKIT_URL \
    NEXT_PUBLIC_STT_RELAY_URL=$NEXT_PUBLIC_STT_RELAY_URL \
    NEXT_PUBLIC_STT_TEST_MODE=$NEXT_PUBLIC_STT_TEST_MODE \
    NEXT_PUBLIC_FIREBASE_API_KEY=$NEXT_PUBLIC_FIREBASE_API_KEY \
    NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=$NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN \
    NEXT_PUBLIC_FIREBASE_DATABASE_URL=$NEXT_PUBLIC_FIREBASE_DATABASE_URL \
    NEXT_PUBLIC_FIREBASE_PROJECT_ID=$NEXT_PUBLIC_FIREBASE_PROJECT_ID \
    NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=$NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET \
    NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=$NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID \
    NEXT_PUBLIC_FIREBASE_APP_ID=$NEXT_PUBLIC_FIREBASE_APP_ID \
    NEXT_OUTPUT=standalone
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Pages that start Firebase are prerendered, so the build fails without its config.
RUN if [ -z "$NEXT_PUBLIC_FIREBASE_API_KEY" ]; then \
      echo "Missing build arg NEXT_PUBLIC_FIREBASE_API_KEY: pass the NEXT_PUBLIC_* values from .env.example as --build-arg." >&2; \
      exit 1; \
    fi
# prebuild downloads the MediaPipe face model into public/mediapipe.
RUN npm run build

# ---- Runtime ----
FROM base AS runner
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
COPY --from=build --chown=node:node /app/public ./public
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/').then(r=>process.exit(r.status<500?0:1),()=>process.exit(1))"
CMD ["node", "server.js"]
