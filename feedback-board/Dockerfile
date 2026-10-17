# STAAD feedback board (Next.js), port 3100. Built as a standalone server.
#
#   docker build -t staad-feedback --build-arg NEXT_PUBLIC_PUBLIC_URL=https://feedback.example.com .
#   docker run --env-file .env -p 3100:3100 staad-feedback
#   docker run --rm --env-file .env staad-feedback node scripts/init-db.mjs   # apply schema.sql
#
# DATABASE_URL, HMAC_SECRET, ADMIN_PASSWORD, TURNSTILE_SECRET_KEY, BLOCKLIST and
# AUTO_HIDE_REPORTS are read at runtime. The NEXT_PUBLIC_* values are baked in
# at build time, so pass them as build args.

FROM node:24.21.0-bookworm-slim AS base
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

# ---- Dependencies ----
FROM base AS deps
COPY package.json package-lock.json ./
RUN npm ci

# ---- Build ----
FROM base AS build
ARG NEXT_PUBLIC_TURNSTILE_SITE_KEY
ARG NEXT_PUBLIC_PUBLIC_URL
ENV NEXT_PUBLIC_TURNSTILE_SITE_KEY=$NEXT_PUBLIC_TURNSTILE_SITE_KEY \
    NEXT_PUBLIC_PUBLIC_URL=$NEXT_PUBLIC_PUBLIC_URL \
    NEXT_OUTPUT=standalone
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

# ---- Runtime ----
FROM base AS runner
ENV NODE_ENV=production PORT=3100 HOSTNAME=0.0.0.0
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
# For `node scripts/init-db.mjs` (pg is already in the standalone node_modules).
COPY --from=build --chown=node:node /app/schema.sql ./
COPY --from=build --chown=node:node /app/scripts ./scripts
USER node
EXPOSE 3100
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3100)+'/').then(r=>process.exit(r.status<500?0:1),()=>process.exit(1))"
CMD ["node", "server.js"]
