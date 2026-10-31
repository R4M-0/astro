# ── build stage ────────────────────────────────────────────────
FROM node:22-alpine AS build
RUN corepack enable
WORKDIR /repo
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/api/vendor apps/api/vendor
RUN pnpm install --frozen-lockfile --filter @astro/api --filter @astro/shared
COPY packages/shared packages/shared
COPY apps/api apps/api
RUN pnpm --filter @astro/shared build \
 && cd apps/api && pnpm prisma generate && pnpm build

# ── runtime stage ──────────────────────────────────────────────
FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /repo
COPY --from=build /repo/node_modules ./node_modules
COPY --from=build /repo/packages ./packages
COPY --from=build /repo/apps/api/node_modules ./apps/api/node_modules
COPY --from=build /repo/apps/api/dist ./apps/api/dist
COPY --from=build /repo/apps/api/prisma ./apps/api/prisma
# `pnpm build` also bundles prisma/seed.ts → dist/seed.js (run: node dist/seed.js)
COPY --from=build /repo/apps/api/package.json ./apps/api/
WORKDIR /repo/apps/api
USER node
EXPOSE 3001
CMD ["node", "dist/main.js"]
