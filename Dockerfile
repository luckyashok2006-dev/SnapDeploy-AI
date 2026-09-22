# syntax=docker/dockerfile:1

# =========================================================================
# Stage 1: Build Frontend (dist/) & Compile Server (dist-server/)
# =========================================================================
FROM node:24-alpine AS builder
WORKDIR /app

# Install build dependencies reproducibly via lockfile
COPY package.json package-lock.json ./
RUN npm ci

# Copy project source and configuration
COPY . .

# Compile frontend (Vite) and backend (esbuild)
RUN npm run build

# =========================================================================
# Stage 2: Minimal Production Runtime
# =========================================================================
FROM node:24-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3001

# Install only production dependencies (excludes tsx, vite, vitest, typescript, etc.)
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force

# Copy pre-compiled artifacts from builder stage with ownership assigned to node user
COPY --from=builder --chown=node:node /app/dist ./dist
COPY --from=builder --chown=node:node /app/dist-server ./dist-server

# Non-root user execution
USER node

# Expose HTTP port
EXPOSE 3001

# Lightweight liveness probe via Node's native fetch (does not invoke Gemini API)
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://localhost:' + (process.env.PORT || 3001) + '/api/health/liveness').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

# Start production server using compiled JavaScript entrypoint
CMD ["node", "dist-server/index.js"]
