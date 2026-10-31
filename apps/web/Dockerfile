# ── build stage ────────────────────────────────────────────────
FROM node:22-alpine AS build
RUN corepack enable
WORKDIR /repo
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY packages/shared/package.json packages/shared/
COPY apps/web/package.json apps/web/
RUN pnpm install --frozen-lockfile --filter @astro/web --filter @astro/shared
COPY packages/shared packages/shared
COPY apps/web apps/web
ARG NEXT_PUBLIC_API_URL
ARG NEXT_PUBLIC_FILES_ORIGIN
# `self-hosted` for customer installs: no marketing site, platform area or billing (see lib/deployment.ts)
ARG NEXT_PUBLIC_DEPLOYMENT_MODE=saas
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL \
    NEXT_PUBLIC_FILES_ORIGIN=$NEXT_PUBLIC_FILES_ORIGIN \
    NEXT_PUBLIC_DEPLOYMENT_MODE=$NEXT_PUBLIC_DEPLOYMENT_MODE
RUN pnpm --filter @astro/shared build && pnpm --filter @astro/web build

# ── runtime stage ──────────────────────────────────────────────
# Next.js standalone output: server.js + only the traced dependencies.
FROM node:22-alpine
ENV NODE_ENV=production \
    PORT=3000 \
    HOSTNAME=0.0.0.0
WORKDIR /app
COPY --from=build --chown=node:node /repo/apps/web/.next/standalone ./
COPY --from=build --chown=node:node /repo/apps/web/.next/static ./apps/web/.next/static
COPY --from=build --chown=node:node /repo/apps/web/public ./apps/web/public
USER node
EXPOSE 3000
CMD ["node", "apps/web/server.js"]
