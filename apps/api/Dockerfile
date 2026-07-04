# Multi-stage build for the NestJS API in a pnpm workspace monorepo.
# Build context MUST be the repository root: `docker build -f apps/api/Dockerfile .`
# No secrets are baked into any layer; configuration is injected at runtime.

# ── Base: pnpm via corepack ───────────────────────────────────────────────
FROM node:26-alpine AS base
ENV PNPM_HOME="/pnpm" \
    PATH="/pnpm:$PATH"
RUN corepack enable
WORKDIR /app

# ── deps: production node_modules only ────────────────────────────────────
FROM base AS deps
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json .npmrc ./
COPY packages/shared/package.json packages/shared/package.json
COPY packages/database/package.json packages/database/package.json
COPY apps/api/package.json apps/api/package.json
RUN pnpm install --frozen-lockfile --prod

# ── builder: full install, generate client, compile ──────────────────────
FROM base AS builder
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json turbo.json tsconfig.base.json .npmrc ./
COPY packages/shared/package.json packages/shared/package.json
COPY packages/database/package.json packages/database/package.json
COPY apps/api/package.json apps/api/package.json
RUN pnpm install --frozen-lockfile
# Source
COPY packages/shared packages/shared
COPY packages/database packages/database
COPY apps/api apps/api
# Generate Prisma client, then build shared → database → api (dependency order).
RUN pnpm --filter @b2b/database exec prisma generate \
 && pnpm --filter @b2b/shared build \
 && pnpm --filter @b2b/database build \
 && pnpm --filter @b2b/api build

# ── runner: minimal, non-root ─────────────────────────────────────────────
FROM base AS runner
ENV NODE_ENV=production
RUN addgroup -g 1001 nestjs && adduser -u 1001 -G nestjs -S nestjs

# Production dependencies (incl. generated Prisma client from builder).
COPY --from=deps  --chown=nestjs:nestjs /app/node_modules ./node_modules
COPY --from=builder --chown=nestjs:nestjs /app/packages/shared/dist   ./packages/shared/dist
COPY --from=builder --chown=nestjs:nestjs /app/packages/shared/package.json ./packages/shared/package.json
COPY --from=builder --chown=nestjs:nestjs /app/packages/database/dist ./packages/database/dist
COPY --from=builder --chown=nestjs:nestjs /app/packages/database/package.json ./packages/database/package.json
COPY --from=builder --chown=nestjs:nestjs /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder --chown=nestjs:nestjs /app/apps/api/dist ./apps/api/dist
COPY --from=builder --chown=nestjs:nestjs /app/apps/api/package.json ./apps/api/package.json

USER nestjs
WORKDIR /app/apps/api
EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget --quiet --tries=1 --spider http://127.0.0.1:3001/health/live || exit 1

CMD ["node", "dist/main.js"]
