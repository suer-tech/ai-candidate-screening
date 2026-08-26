# syntax=docker/dockerfile:1
# HH AI-screener — единый образ для web, worker, media и document processors.
# Сервис выбирается командой (npm run start / service:*), конфигурация монтируется
# через HH_RUNTIME_CONFIG_ROOT (см. deploy/docker/docker-compose*.yml).
# Healthcheck задаётся в docker-compose per-service (web проверяет /api/health/live).

FROM node:22-bookworm-slim AS deps
ENV NODE_ENV=production
RUN npm install -g npm@11
WORKDIR /app/web
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts \
  && npm rebuild @esbuild/linux-x64 esbuild 2>/dev/null || true

FROM node:22-bookworm-slim AS build
RUN npm install -g npm@11
WORKDIR /app/web
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production
RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg \
  && ffmpeg -version \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app/web
COPY --from=deps /app/web/node_modules ./node_modules
COPY --from=build /app/web/.output ./.output
COPY --from=build /app/web/drizzle-postgres ./drizzle-postgres
COPY --from=build /app/web/package.json ./package.json
COPY --from=build /app/web/server ./server
COPY --from=build /app/web/scripts ./scripts
COPY --from=build /app/web/app ./app
COPY --from=build /app/web/db ./db
COPY --from=build /app/web/public ./public

# Порты: web=3000, media-processor=4311, document-processor=4312, fixture-controller=4077.
EXPOSE 3000 4311 4312 4077

CMD ["npm", "run", "start"]
