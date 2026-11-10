# syntax=docker/dockerfile:1.7
# Single container: API + built web app (served by the API with CSP). PostgreSQL runs separately.
FROM node:22-bookworm-slim AS base
# COREPACK_HOME: keep pnpm inside the image so the non-root runtime user does not
# download it again on every start (the app must start without internet access).
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH COREPACK_HOME=/corepack
RUN corepack enable && corepack prepare pnpm@10.28.0 --activate && chmod -R a+rX /corepack
WORKDIR /app

FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages/engine/package.json packages/engine/
COPY packages/config/package.json packages/config/
COPY packages/i18n/package.json packages/i18n/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY e2e/package.json e2e/
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile --filter "!@salon/e2e"

FROM deps AS build
COPY . .
RUN pnpm --filter @salon/web build

FROM base AS runtime
ENV NODE_ENV=production PORT=3000 STATIC_DIR=/app/apps/web/dist
COPY --from=build /app /app
RUN rm -rf /app/e2e /app/apps/web/src /app/reference && chown -R node:node /app
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --retries=3 CMD node -e "fetch('http://localhost:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
# Migrations run on start (forward-only, guarded by an advisory lock).
CMD ["pnpm", "--filter", "@salon/api", "start"]
