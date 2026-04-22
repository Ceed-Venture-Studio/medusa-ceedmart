FROM node:22-bookworm-slim AS base
RUN apt-get update \
 && apt-get install --no-install-recommends -y tini python3 make g++ \
 && rm -rf /var/lib/apt/lists/*
RUN corepack enable

# ── Stage 1 — install workspace deps and build app/ceedmart ──────────────
FROM base AS builder
WORKDIR /workspace

# Workspace metadata (cache-friendly layer)
COPY package.json yarn.lock .yarnrc.yml _tsconfig.base.json turbo.json ./
COPY .yarn/ ./.yarn/

# Workspace source
COPY packages/ ./packages/
COPY app/ ./app/

# Install the whole workspace. Tolerate soft warnings.
RUN yarn install --network-timeout 600000 || yarn install --network-timeout 600000

# Build all workspace packages.
#
# We deliberately do NOT use --filter='ceedmart^...' here. The @medusajs/medusa
# package re-exports every workspace module via packages/medusa/src/modules/*.ts
# stubs (e.g. `import RbacModule from "@medusajs/rbac"`) without declaring those
# packages as deps. Filtered turbo runs miss them and the medusa TS build fails
# with "Cannot find module '@medusajs/rbac'".
ENV NODE_OPTIONS=--max-old-space-size=4096
RUN yarn turbo run build --concurrency=100% --no-daemon

# Now build the Ceedmart app → outputs to app/ceedmart/.medusa/server/
WORKDIR /workspace/app/ceedmart
ENV DISABLE_MEDUSA_ADMIN=false
RUN yarn build

# ── Stage 2 — lean runner ────────────────────────────────────────────────
FROM base AS runner
RUN groupadd --system medusa \
 && useradd --system --gid medusa --create-home --home-dir /home/medusa medusa
WORKDIR /app

# Copy the entire workspace. app/ceedmart/.medusa/server/ holds the built app.
# Runtime resolves workspace deps via the whole tree, so ship it all.
COPY --from=builder --chown=medusa:medusa /workspace /app

USER medusa
WORKDIR /app/app/ceedmart

ENV NODE_ENV=production
ENV PORT=9000
ENV DISABLE_MEDUSA_ADMIN=true
ENV MEDUSA_WORKER_MODE=shared

EXPOSE 9000

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["sh", "-c", "yarn medusa db:migrate && yarn medusa start -H 0.0.0.0 -p ${PORT:-9000}"]
