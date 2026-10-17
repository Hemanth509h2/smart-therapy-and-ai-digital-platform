# STAAD backend (Next.js API behind the custom server.js), port 4000.
#
#   docker build -t staad-backend .
#   docker run -p 4000:4000 -v "$PWD/.env:/app/.env:ro" staad-backend
#
# All secrets (DATABASE_URL, FIREBASE_*, LIVEKIT_*, ...) are read at runtime.
# server.js loads /app/.env itself, so mounting the file keeps the .env syntax
# (quotes, inline # comments); `--env-file` or plain -e variables work too, but
# docker passes those values literally. Only the NEXT_PUBLIC_* values below are
# baked in at build time.
#
# Prisma CLI, seed and maintenance scripts need the dev dependencies, which the
# runtime image leaves out. Use the `tools` target for them:
#   docker build --target tools -t staad-backend-tools .
#   docker run --rm -v "$PWD/.env:/app/.env:ro" staad-backend-tools npx prisma db push
#   docker run --rm -v "$PWD/.env:/app/.env:ro" staad-backend-tools npm run seed:admin

FROM node:24.21.0-bookworm-slim AS base
# Prisma's query engine needs OpenSSL.
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

# ---- Dependencies (cached until package*.json or the Prisma schema change) ----
FROM base AS deps
COPY package.json package-lock.json ./
# postinstall runs `prisma generate`, which needs the schema.
COPY prisma ./prisma
RUN npm ci

# ---- Build ----
FROM base AS build
ARG NEXT_PUBLIC_LIVEKIT_URL
ARG NEXT_PUBLIC_STT_RELAY_URL
ARG NEXT_PUBLIC_STT_TEST_MODE=false
ENV NEXT_PUBLIC_LIVEKIT_URL=$NEXT_PUBLIC_LIVEKIT_URL \
    NEXT_PUBLIC_STT_RELAY_URL=$NEXT_PUBLIC_STT_RELAY_URL \
    NEXT_PUBLIC_STT_TEST_MODE=$NEXT_PUBLIC_STT_TEST_MODE
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

# ---- Tools: full dependencies + sources, for prisma / seed / maintenance scripts ----
FROM build AS tools
CMD ["npx", "prisma", "db", "push"]

# ---- Production dependencies only (keeps the generated Prisma client) ----
FROM build AS prod-deps
RUN npm prune --omit=dev

# ---- Runtime ----
FROM base AS runner
ENV NODE_ENV=production PORT=4000
COPY --from=prod-deps --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/.next ./.next
COPY --from=build --chown=node:node /app/package.json /app/server.js ./
COPY --from=build --chown=node:node /app/prisma ./prisma
USER node
EXPOSE 4000
# Any HTTP answer means the server is up (the API has no dedicated health route).
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||4000)+'/').then(()=>process.exit(0),()=>process.exit(1))"
CMD ["node", "server.js", "--prod"]
