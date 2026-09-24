# SnapDeploy AI

SnapDeploy AI is an enterprise-grade web application platform that enables users to generate, edit, run, diagnose, repair, and export production-ready full-stack React + TypeScript applications directly in the browser using in-browser WebContainer sandboxes and Google Gemini AI.

---

## Architecture Overview

SnapDeploy AI combines a client-side Virtual File System (VFS) and WebContainer runtime sandbox with a hardened Node.js/Express backend:

```
Browser Client (React 19 + Monaco + WebContainer)
  │
  ├─► WebContainer Sandbox (SharedArrayBuffer execution, Vite dev server, npm, tsc)
  ├─► Virtual File System (Authoritative in-memory project store, snapshot checkpoints)
  │
  ▼
Backend Server (Express + Security Middleware)
  │
  ├─► Security Boundary (CORS whitelist, 30 req/min rate limiting, 2MB body limit, error sanitization)
  ├─► GeminiAIProvider (Strict schema prompt synthesis, canonical lockfile injection)
  ├─► Diagnostic & Repair Services (Stack trace & evidence analysis, transactional patch synthesis)
  └─► Static File Server (Serves production build with required COOP/COEP headers)
```

---

## Key Features

1. **AI Generation**: Synthesizes complete, runnable React 18/19 + TypeScript + Vite web applications.
2. **Deterministic Canonical Lockfile Injection**: Zero-cost cold resolution avoiding npm timeout in browser sandbox.
3. **In-Browser WebContainer Execution**: Real Node.js process runtime inside the browser with genuine stdout, stderr, and live preview.
4. **Self-Healing AI Repair Loop**: Captures real execution evidence, diagnoses compilation/runtime errors, synthesizes strict unified diff patches, and verifies fixes with tsc and build checks.
5. **Transactional Rollback**: Automatic pre-repair snapshots; failed repairs roll back all project files byte-for-byte in both VFS and sandbox runtime.
6. **Hardened Security**:
   - Zero client-side API keys (Gemini credentials remain strictly on backend server).
   - Ingress rate limiting (30 requests/minute per client IP) with `Retry-After`.
   - Path traversal prevention, UNC/network path blocking, and null-byte rejection.
   - Comprehensive error sanitization (paths and tokens masked).
   - Truthful ZIP export excluding `.env`, `node_modules`, `dist`, and `.git`.
7. **Observability & Cost Protection**:
   - Structured JSON logging with request correlation (`X-Request-Id`).
   - Cold-start detection (`isColdStart`, `bootDurationMs`) tracking container boot overhead.
   - Real-time Gemini token telemetry (`promptTokens`, `candidatesTokens`, `totalTokens`).
   - Runaway generation ceiling (`maxOutputTokens: 8192`) on all AI operations.
   - Process-local global daily circuit breaker (`DAILY_AI_REQUEST_LIMIT`, default 1000) resetting at 00:00 UTC.
   - Rolling in-memory latency percentiles (p50, p95, p99, max, avg) exposed via `/api/ai/status`.

---

## Prerequisites

- **Node.js**: >= 20.0.0 (Node 22 or Node 24 LTS recommended)
- **npm**: >= 9.0.0
- **Google Gemini API Key**: Obtain from [Google AI Studio](https://aistudio.google.com/app/apikey)
- **Browser**: Modern Chromium-based browser (Chrome, Edge, Brave) with SharedArrayBuffer support.

---

## Installation & Setup

1. **Clone the repository**:
   ```bash
   git clone <repo-url>
   cd "SnapDeploy AI"
   ```

2. **Install dependencies**:
   ```bash
   npm install
   ```

3. **Configure Environment Variables**:
   Copy the example environment template:
   ```bash
   cp .env.example .env
   ```
   Edit `.env` and provide your real Gemini API key:
   ```env
   PORT=3001
   GEMINI_API_KEY=AIzaSy...your_actual_key_here
   GEMINI_MODEL=gemini-3.5-flash-lite
   DAILY_AI_REQUEST_LIMIT=1000
   ALLOWED_ORIGINS=http://localhost:3000,http://localhost:5173
   NODE_ENV=development
   ```

---

## Running in Development Mode

Start both the backend Express server and Vite development frontend concurrently:

```bash
npm run dev
```

- **Frontend Client**: http://localhost:3000
- **Backend API**: http://localhost:3001
- **API Health Check**: http://localhost:3001/api/health

---

## Production Build & Start

1. **Build the production client and server**:
   ```bash
   npm run build
   ```
   This orchestrates:
   - `npm run build:client`: Compiles TypeScript and bundles client assets into `dist/`.
   - `npm run build:server`: Bundles the Express server with esbuild into `dist-server/index.js` and copies server templates.

2. **Start the production server**:
   ```bash
   npm start
   ```
   Starts the compiled Express server using plain Node (`node dist-server/index.js`) on `PORT` (default 3001). No `tsx` or TypeScript runtime compiler is required in production.

   When `dist/` is present, the server serves the production SPA and all `/api/*` endpoints on the same port with required WebContainer isolation headers (`COOP: same-origin`, `COEP: require-corp`).

### Production AI & Mock-Provider Safety Contract
- **Mock Providers Disabled**: In production (`NODE_ENV=production`), mock deployment, mock auth, and mock database providers are strictly disabled and will throw if invoked. There is **zero** automatic fallback to mock services in production.
- **Fail-Closed AI Endpoints**: If `GEMINI_API_KEY` is absent or unconfigured in production, all AI generation, repair, and diagnostic endpoints return **HTTP 503** (`GEMINI_PROVIDER_UNAVAILABLE`), and the readiness probe (`/api/health/readiness`) reports **HTTP 503** (`GEMINI_PROVIDER_UNCONFIGURED`). Liveness (`/api/health/liveness`) remains **HTTP 200**.

---

## Production Deployment

SnapDeploy AI is deployed and live in production as a Docker Web Service on Render:

- **Live URL**: [https://snapdeploy-ai.onrender.com](https://snapdeploy-ai.onrender.com)
- **Platform**: Render Web Service (Singapore, Docker Node 24 Alpine runtime)
- **AI Model**: Google Gemini (`gemini-3.5-flash-lite`)
- **Operational Runbook**: See [`DEPLOYMENT.md`](./DEPLOYMENT.md) for full deployment specifications, verified validation matrices, environment configurations, and incident response procedures.

### Topology: Unified Single-Container Service
Deploy the application as a container (Docker, Render, Railway, Fly.io, or AWS ECS):
1. Run `npm run build` during container build stage.
2. Set environment variables (`PORT`, `GEMINI_API_KEY`, `NODE_ENV=production`, `TRUST_PROXY=1`, `ALLOWED_ORIGINS`).
3. Start the application via `npm start` (`node dist-server/index.js`).
4. Express serves the static frontend assets and API routes on the single assigned port.

### Critical Production Header Requirements
WebContainer requires Cross-Origin Isolation in the browser:
- `Cross-Origin-Embedder-Policy: require-corp`
- `Cross-Origin-Opener-Policy: same-origin`
- `Cross-Origin-Resource-Policy: cross-origin`

These headers are automatically injected by `server/index.ts` for all served assets and API responses.

---

## Testing & Quality Gate

- **Type Check**: `npx tsc --noEmit`
- **Unit & Security Tests**: `npx vitest run`
- **Telemetry & Quota Test Suite**: `npx vitest run tests/ai-quota-latency.test.ts tests/structured-logging.test.ts`
- **Focused Security & Patch Suite**: `npx vitest run tests/security.test.ts tests/patch-validation.test.ts`
- **30-Step Chromium E2E Gate**: `npx playwright test tests/browser-e2e.spec.ts`
