# SnapDeploy AI — Production Deployment & Operational Runbook

This document serves as the authoritative operational runbook and deployment specification for SnapDeploy AI in production.

---

## 1. Verified Production State

| Property | Value / Setting |
| :--- | :--- |
| **Application** | SnapDeploy AI |
| **Hosting Platform** | Render Web Service (Docker Runtime) |
| **Region** | Singapore (Southeast Asia / `singapore`) |
| **Current Compute Plan** | Free Tier (0.5 vCPU, 512 MB RAM, spins down on idle) |
| **Live Public URL** | [https://snapdeploy-ai.onrender.com](https://snapdeploy-ai.onrender.com) |
| **Git Repository** | `https://github.com/luckyashok2006-dev/SnapDeploy-AI` |
| **Git Branch** | `main` |
| **Verified Release Commit** | `041228af5807a490c0bb37f2d260d79634a85163` (Phase 8.2.7 Operational Telemetry & Cost Controls Baseline) |
| **Base Docker Image** | `node:24-alpine` (multi-stage build, unprivileged user `node`) |
| **Server Runtime** | Compiled Node.js 24 ESM (`node dist-server/index.js`) |
| **Container Port Binding** | Injected by platform (`PORT`, default `10000`), binds `HOST=0.0.0.0` |
| **Health & Status Endpoints** | `GET /api/health/liveness`, `GET /api/health/readiness`, `GET /api/ai/status` |
| **Auto-Deploy Behavior** | Enabled on Push to `main` (auto-builds via Dockerfile) |
| **Production AI Provider** | Google Gemini AI (`GeminiAIProvider`) |
| **Production AI Model** | `gemini-3.5-flash-lite` (maxOutputTokens: 8192) |
| **Daily AI Request Ceiling** | `DAILY_AI_REQUEST_LIMIT=1000` (process-local runaway cost breaker, resets 00:00 UTC) |

---

## 2. Production Architecture & Ingress Flow

```
[ User Browser (React 19 + Monaco + WebContainer) ]
  │
  ├─► [ Client-Side WebContainer Sandbox (SharedArrayBuffer) ]
  │     └─► Direct browser connections to *.webcontainer-api.io & stackblitz.com
  │
  ├─► HTTPS Request (TLS Terminated at Edge)
  │     ▼
  ├─► Cloudflare Edge (Injects CF-Connecting-IP & CF-Ray)
  │     ▼
  ├─► Render Ingress Load Balancer (Overlay Network)
  │     ▼
  └─► SnapDeploy Web Container (Express on assigned PORT)
        ├─► Canonical extractClientIp() reads verified CF-Connecting-IP
        ├─► In-Memory Rate Limiter (30 requests/minute per client IP)
        ├─► Input Validation & Prompt Size Gate (Max 10,000 chars)
        ├─► Static Asset Serving with COOP/COEP & Cache-Control
        ├─► Request Correlation Middleware (X-Request-Id UUID v4)
        ├─► Structured JSON Logging to stdout/stderr
        └─► Google Gemini API (https://generativelanguage.googleapis.com)
```

---

## 3. Verified Production Validation Matrix

All 21 production capabilities have been forensically tested and validated against the live deployment at `https://snapdeploy-ai.onrender.com`:

| # | Check / Feature | Verification Result | Live Production Evidence |
| :-: | :--- | :---: | :--- |
| **1** | **Remote Docker Build** | **PASSED** | Multi-stage build compiles `dist/` (Vite) and `dist-server/` (esbuild). Executes as non-root user `node`. |
| **2** | **Liveness Health Probe** | **PASSED** | `GET /api/health/liveness` returns HTTP 200 with `{ "status": "ok", "timestamp": "..." }`. |
| **3** | **Readiness Health Probe** | **PASSED** | `GET /api/health/readiness` returns HTTP 200 with `{ "status": "ready", "checks": { "server": "ok", "aiProvider": "configured" } }`. |
| **4** | **Gemini Provider Status** | **PASSED** | `GET /api/ai/status` returns HTTP 200 confirming `provider: "gemini"`, `model: "gemini-3.5-flash-lite"`, `configured: true`. |
| **5** | **Real AI Generation** | **PASSED** | `POST /api/generate` successfully synthesized a full React + TypeScript application with 13 project files in 32.2 seconds. |
| **6** | **Request Correlation** | **PASSED** | `X-Request-Id` UUID v4 header generated, attached to response headers, and preserved across structured log events. |
| **7** | **CORS Whitelist** | **PASSED** | Requests from `https://snapdeploy-ai.onrender.com` receive `access-control-allow-origin: https://snapdeploy-ai.onrender.com` with `credentials: true`. |
| **8** | **CORS Preflight** | **PASSED** | `OPTIONS` requests return HTTP 204 with `Access-Control-Allow-Methods` and `Access-Control-Allow-Headers`. |
| **9** | **Cloudflare Client-IP Extraction** | **PASSED** | Canonical `extractClientIp()` extracts verified client IP from Cloudflare `CF-Connecting-IP` header with `net.isIP` validation. |
| **10**| **Ingress Rate Limiting** | **PASSED** | Requests 1–30 pass rate limiting; Request 31 triggers HTTP 429 (`RATE_LIMIT_EXCEEDED`) with `Retry-After: 55`. |
| **11**| **Prompt Boundary Guard** | **PASSED** | Prompts exceeding 10,000 characters (10,001 chars tested) are rejected with HTTP 400 (`PROMPT_TOO_LARGE`) before Gemini invocation. |
| **12**| **Static Asset Caching** | **PASSED** | Hashed assets (`/assets/*.js`, `/assets/*.css`) return `Cache-Control: public, max-age=31536000, immutable`. |
| **13**| **HTML Caching & COOP/COEP** | **PASSED** | `index.html` returns `public, max-age=0, must-revalidate` along with `COOP: same-origin` and `COEP: require-corp`. |
| **14**| **Missing Asset 404** | **PASSED** | Nonexistent static assets (`/assets/nonexistent.js`) return HTTP 404 rather than fallback HTML. |
| **15**| **Error Sanitization** | **PASSED** | Client error responses return sanitized error codes and messages without leaking tokens, filesystem paths, or stack traces. |
| **16**| **WebContainer & ZIP Export**| **PASSED** | Cross-origin isolation headers enable in-browser `SharedArrayBuffer` for WebContainer dev server, terminal, and client-side ZIP export. |
| **17**| **Cold-Start Telemetry** | **PASSED** | First handled request emits `isColdStart: true` and `bootDurationMs` in structured JSON log; subsequent requests emit `isColdStart: false`. |
| **18**| **Gemini Token Telemetry** | **PASSED** | Structured completion logs capture `promptTokens`, `candidatesTokens`, and `totalTokens` from Gemini `usageMetadata` without prompt/code leakage. |
| **19**| **Runaway Cost Safeguard** | **PASSED** | Strict `maxOutputTokens: 8192` enforced across all Gemini generation, diagnostic, repair, and edit operations. |
| **20**| **Global Daily AI Circuit Breaker** | **PASSED** | Process-local daily ceiling (`DAILY_AI_REQUEST_LIMIT`, default 1000) resets at 00:00 UTC; exceeding quota returns HTTP 429 (`DAILY_QUOTA_EXCEEDED`) with `Retry-After` and `X-RateLimit-*-Daily` headers. |
| **21**| **Rolling Latency Telemetry** | **PASSED** | Ring buffer (bounded 100 samples) computes rolling `p50`, `p95`, `p99`, `avgMs`, `maxMs`, and `sampleCount` exposed at `GET /api/ai/status`. |

---

## 4. Intentional Architecture Deferments

The following architectural and operational concerns are intentionally deferred to future iterations:

1.  **Paid Always-On Compute**:
    *   *Current State*: Render Free tier (service spins down after 15 minutes of inactivity).
    *   *Upgrade Path*: Upgrade to Render Starter ($7/month) to guarantee 24/7 continuous uptime and zero cold starts when user traffic warrants it.
2.  **Custom Branded Domain & DNS**:
    *   *Current State*: Serving on Render default domain `https://snapdeploy-ai.onrender.com`.
    *   *Upgrade Path*: Provision a custom domain (e.g. `app.snapdeploy.ai`), configure DNS CNAME records, and update `ALLOWED_ORIGINS`.
3.  **Distributed Rate Limiting & Multi-Instance Daily Quota (Redis / KeyDB)**:
    *   *Current State*: Single-instance in-memory map accurately enforces 30 req/min per IP and process-local daily AI ceiling (`DAILY_AI_REQUEST_LIMIT=1000`, 00:00 UTC reset). This process-local ceiling serves as a runaway-cost circuit breaker on single-container deployments, not a distributed billing guarantee.
    *   *Upgrade Path*: Connect to Redis / Upstash to synchronize both per-IP rate limits and global daily invocation counters when horizontally scaling across multiple container instances.
4.  **Persistent Server-Side Project Storage**:
    *   *Current State*: All project files, edits, and snapshots reside in the client-side Virtual File System (VFS).
    *   *Upgrade Path*: Add PostgreSQL/Prisma user authentication and S3/R2 storage for server-side workspace persistence.
5.  **Centralized Observability Ingestion**:
    *   *Current State*: Structured JSON logs stream to stdout/stderr in the Render console.
    *   *Upgrade Path*: Configure log forwarding to Datadog, Grafana Loki, or OpenTelemetry collector.
6.  **External CSP Violation Reporting**:
    *   *Current State*: CSP is actively enforced (`Content-Security-Policy`); `report-uri` is omitted to prevent unhandled report noise.
    *   *Upgrade Path*: Route violation reports to an external dedicated reporting collector (e.g. Sentry / Report-URI) if deep client telemetrics are required.

---

## 5. Operational Procedures & Runbook

### A. Environment Configuration
The Render Web Service requires the following environment variables:

| Variable | Type | Value / Description |
| :--- | :--- | :--- |
| `NODE_ENV` | Configuration | `production` |
| `PORT` | Platform | Automatically set by Render (typically `10000`) |
| `HOST` | Configuration | `0.0.0.0` |
| `GEMINI_API_KEY` | Secret | Real Google Gemini API Key from Google AI Studio |
| `GEMINI_MODEL` | Configuration | `gemini-3.5-flash-lite` |
| `DAILY_AI_REQUEST_LIMIT` | Configuration | `1000` (Process-local daily AI ceiling; resets 00:00 UTC) |
| `TRUST_PROXY` | Configuration | `1` |
| `ALLOWED_ORIGINS` | Configuration | `https://snapdeploy-ai.onrender.com` |
| `SHUTDOWN_TIMEOUT_MS` | Configuration | `25000` |
| `CSP_ENABLED` | Configuration | `true` |
| `CSP_REPORT_ONLY` | Configuration | `false` |

### B. Deployment & Rollback Workflow
1.  **Standard Deploy**: Pushing any commit to `main` triggers Render's automated cloud build pipeline.
2.  **Manual Rollback**: In the Render Dashboard under **Events**, select a previous successful build and click **Rollback to this deploy** for instant zero-downtime reversion.
3.  **Local Testing Gate**: Before pushing releases to `main`:
    ```bash
    npm run typecheck:server
    npm run typecheck:client
    npm test
    npm run build
    ```

### C. Incident Response & Troubleshooting
*   **503 Service Unavailable (`GEMINI_PROVIDER_UNAVAILABLE`)**: Verify `GEMINI_API_KEY` is present in Render Environment Variables and not expired/quota-exhausted in Google AI Studio. Check `/api/health/readiness`.
*   **429 Too Many Requests (`RATE_LIMIT_EXCEEDED`)**: Client has exceeded 30 AI requests within 60 seconds. Inspect the `Retry-After` response header.
*   **429 Too Many Requests (`DAILY_QUOTA_EXCEEDED`)**: Process-local daily AI request ceiling reached (default 1000 requests/day). Check `Retry-After` header (seconds remaining until 00:00 UTC reset) or `X-RateLimit-Reset-Daily` timestamp. To adjust, configure `DAILY_AI_REQUEST_LIMIT`.
*   **CORS Error (`Not allowed by CORS`)**: Verify the calling domain is listed in `ALLOWED_ORIGINS`.
*   **WebContainer Initialization Failure**: Inspect browser console for `SharedArrayBuffer` errors. Ensure `COOP` and `COEP` response headers are not stripped by intermediate proxies.
