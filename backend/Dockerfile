# Backend Dockerfile - Custom Next.js server with Sarvam STT WebSocket proxy
FROM node:20-alpine AS builder

WORKDIR /app

# Install dependencies
COPY package.json package-lock.json ./
RUN npm install --frozen-lockfile

# Copy source code
COPY . .

# Build the Next.js app (generates Prisma client + builds Next.js)
RUN npm run build

# Production stage
FROM node:20-alpine AS production

WORKDIR /app

# Copy built application
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/server.js ./server.js
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma

# Install production dependencies only
RUN npm install --frozen-lockfile --omit=dev

# Generate Prisma client (ensures it's available at runtime)
RUN npx prisma generate

# Set environment
ENV NODE_ENV=production
ENV PORT=4000

# Expose port
EXPOSE 4000

# Start the application (custom server with STT proxy)
CMD ["node", "server.js", "--prod"]