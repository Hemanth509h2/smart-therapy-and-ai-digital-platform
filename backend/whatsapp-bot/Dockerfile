FROM node:20-bullseye-slim AS builder

WORKDIR /app
COPY package.json package-lock.json ./
# Baileys depends on libsignal-node which pulls from git+ssh in the lockfile.
# Rewrite to HTTPS so it builds without SSH keys.
RUN apt-get update && apt-get install -y git && \
    git config --global url."https://github.com/".insteadOf ssh://git@github.com/ && \
    npm ci

FROM node:20-bullseye-slim
WORKDIR /app
COPY --from=builder /app/node_modules ./node_modules
COPY . .

# Ensure auth_info directory exists and is writable
RUN mkdir -p /app/auth_info && chown -R node:node /app/auth_info

USER node
ENV PORT=8080
EXPOSE 8080
CMD ["npm", "start"]
