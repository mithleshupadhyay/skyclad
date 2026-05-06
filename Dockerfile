FROM node:22-bookworm-slim

WORKDIR /app

ENV PORT=3000 \
    DATABASE_PATH=/app/data/skyclad-gateway.db

RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
  && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm ci --include=dev

COPY tsconfig.json ./
COPY src ./src
COPY README.md DESIGN.md ./
COPY docs ./docs

RUN npm run build \
  && npm prune --omit=dev \
  && mkdir -p /app/data \
  && chown -R node:node /app

ENV NODE_ENV=production

USER node

EXPOSE 3000

CMD ["node", "dist/src/server.js"]
