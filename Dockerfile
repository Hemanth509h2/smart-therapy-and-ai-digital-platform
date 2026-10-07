FROM node:20-alpine AS builder

WORKDIR /app

# Install dependencies
COPY frontend/package.json frontend/package-lock.json ./
RUN npm install --frozen-lockfile

COPY backend/package.json backend/package-lock.json ./
RUN npm install --frozen-lockfile

# Copy source code
COPY frontend/ ./frontend/
COPY backend/ ./backend/

# Build the Next.js app
RUN npm run build --prefix=./frontend

# Production stage
FROM node:20-alpine AS production

WORKDIR /app

# Copy built frontend
COPY --from=builder /app/frontend/.next ./frontend/.next
COPY --from=builder /app/frontend/next.config.mjs ./frontend/next.config.mjs
COPY --from=builder /app/frontend/package.json ./frontend/package.json
COPY --from=builder /app/frontend/prisma ./frontend/prisma

# Copy backend
COPY --from=builder /app/backend ./backend
COPY --from=builder /app/backend/package.json ./backend/package.json
COPY --from=builder /app/backend/server.js ./backend/server.js
COPY --from=builder /app/backend/prisma ./backend/prisma

# Install production dependencies only
WORKDIR /app/backend
RUN npm install --frozen-lockfile --omit=dev

# Set environment
ENV NODE_ENV=production
ENV PORT=4000

# Expose port
EXPOSE 4000

# Start the application
CMD ["node", "server.js"]