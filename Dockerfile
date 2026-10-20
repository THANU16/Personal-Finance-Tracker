# WealthTrack — self-host image (Phase 12). Multi-stage: install → build (Next standalone) → run as
# a non-root user. Runtime configuration comes from the environment (see README "Docker").
FROM node:24-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
# --ignore-scripts: no git hooks (husky) and no test-only binary downloads inside the image.
RUN npm ci --ignore-scripts

FROM node:24-alpine AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# The build validates the environment; these placeholders are build-time only (no secrets, never
# used at runtime — the real values come from the container environment).
RUN MONGODB_URI="mongodb://build-placeholder:27017/wealthtrack" \
    BETTER_AUTH_SECRET="build-time-placeholder-secret-not-used-at-runtime" \
    BETTER_AUTH_URL="http://localhost:3000" \
    APP_URL="http://localhost:3000" \
    CRON_SECRET="build-time-placeholder" \
    npm run build

FROM node:24-alpine AS run
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    STORAGE_LOCAL_DIR=/app/.uploads
RUN addgroup -S app && adduser -S app -G app
COPY --from=build --chown=app:app /app/.next/standalone ./
COPY --from=build --chown=app:app /app/.next/static ./.next/static
COPY --from=build --chown=app:app /app/public ./public
RUN mkdir -p /app/.uploads && chown app:app /app/.uploads
USER app
EXPOSE 3000
CMD ["node", "server.js"]
