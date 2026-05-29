# ─────────────────────────────────────────────
# Stage 1: build the Vue SPA and botGuardScript
# ─────────────────────────────────────────────
FROM node:22-alpine AS builder

# Enable pnpm via corepack (ships with Node 20)
RUN corepack enable

WORKDIR /build

# Copy manifests first so dependency installs are cached independently of source changes
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./

# ELECTRON_SKIP_BINARY_DOWNLOAD: skip the 200 MB Electron binary (not needed for web build)
# LEFTHOOK=0: skip git-hook installation (no .git repo in Docker)
ENV ELECTRON_SKIP_BINARY_DOWNLOAD=1
ENV LEFTHOOK=0

RUN pnpm install --frozen-lockfile

# Copy source tree (everything .dockerignore doesn't exclude)
COPY _icons/ ./_icons/
COPY _scripts/ ./_scripts/
COPY src/ ./src/
COPY static/ ./static/

# Build botGuardScript bundle (needed by the Express PoToken service)
# then build the web SPA
RUN pnpm pack:botGuardScript && pnpm pack:web

# ─────────────────────────────────────────────
# Stage 2: runtime – Playwright image ships Chromium pre-installed
# ─────────────────────────────────────────────
FROM mcr.microsoft.com/playwright:v1.60.0-jammy AS runtime

WORKDIR /app

# Copy built assets from stage 1
COPY --from=builder /build/dist/web        ./dist/web
COPY --from=builder /build/dist/botGuardScript.js ./dist/botGuardScript.js

# Copy server source
COPY server/index.js         ./server/index.js
COPY server/package.json     ./server/package.json
COPY server/package-lock.json ./server/package-lock.json
COPY server/routes/          ./server/routes/
COPY server/services/        ./server/services/

# Install server production dependencies
# (playwright is already on disk in the base image at $PLAYWRIGHT_BROWSERS_PATH)
RUN cd server && npm ci --omit=dev

ENV NODE_ENV=production
ENV PORT=8080

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD curl -sf http://localhost:${PORT}/api/health || exit 1

CMD ["node", "server/index.js"]
