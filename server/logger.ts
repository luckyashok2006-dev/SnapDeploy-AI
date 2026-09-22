import crypto from 'crypto';
import net from 'net';
import type { Request, Response, NextFunction } from 'express';

export type LogLevel = 'info' | 'warn' | 'error' | 'debug';

export interface StructuredLogEvent {
  timestamp: string;
  level: LogLevel;
  message: string;
  requestId?: string;
  method?: string;
  path?: string;
  statusCode?: number;
  durationMs?: number;
  clientIp?: string;
  errorCode?: string;
  error?: string;
  [key: string]: any;
}

/**
 * Sanitizes messages to prevent accidental leakage of paths, keys, tokens, or credentials.
 * Preserves standard redaction tokens compatible with existing security tests.
 */
export function sanitizeErrorMessage(msg: string): string {
  if (!msg) return 'An error occurred while processing the request';
  return msg
    .replace(/AIzaSy[0-9A-Za-z-_]{25,45}/g, '[REDACTED_API_KEY]')
    .replace(/sk-[a-zA-Z0-9]{20,}/g, '[REDACTED_API_KEY]')
    .replace(/ghp_[a-zA-Z0-9]{36}/g, '[REDACTED_GITHUB_TOKEN]')
    .replace(/github_pat_[a-zA-Z0-9_]{82}/g, '[REDACTED_GITHUB_TOKEN]')
    .replace(/nfp_[a-zA-Z0-9]{40,}/g, '[REDACTED_NETLIFY_TOKEN]')
    .replace(/Bearer\s+[a-zA-Z0-9_.-]+/gi, 'Bearer [REDACTED]')
    .replace(/eyJ[a-zA-Z0-9_-]{20,}\.[a-zA-Z0-9_-]{20,}\.[a-zA-Z0-9_-]{20,}/g, '[REDACTED_JWT]')
    .replace(/[a-zA-Z]:\\[^\s:"']+/g, '[REDACTED_PATH]')
    .replace(/\/(Users|home|root|etc|var)\/[^\s:"']+/g, '[REDACTED_PATH]');
}

/**
 * Recursively sanitizes strings and sensitive field keys in log context objects.
 */
export function sanitizeLogObject<T>(obj: T): T {
  if (typeof obj === 'string') {
    return sanitizeErrorMessage(obj) as unknown as T;
  }
  if (Array.isArray(obj)) {
    return obj.map((item) => sanitizeLogObject(item)) as unknown as T;
  }
  if (obj !== null && typeof obj === 'object') {
    const result: Record<string, any> = {};
    for (const [k, v] of Object.entries(obj)) {
      if (/(password|passwd|secret|token|api[-_]?key|authorization|cookie|session|credentials)/i.test(k)) {
        result[k] = '[REDACTED]';
      } else {
        result[k] = sanitizeLogObject(v);
      }
    }
    return result as T;
  }
  return obj;
}

/**
 * Validates and normalizes an untrusted incoming request ID.
 * - Bounded length: 1 to 64 characters
 * - Safe character set: alphanumeric, hyphen, underscore (/^[a-zA-Z0-9_-]{1,64}$/)
 * - Rejects control characters, CRLF, spaces, or oversized values
 */
export function validateRequestId(headerVal: unknown): string | null {
  let str: string;
  if (typeof headerVal === 'string') {
    str = headerVal;
  } else if (Array.isArray(headerVal) && typeof headerVal[0] === 'string') {
    str = headerVal[0];
  } else {
    return null;
  }
  const trimmed = str.trim();
  if (!trimmed || trimmed.length > 64) {
    return null;
  }
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(trimmed)) {
    return null;
  }
  return trimmed;
}

/**
 * Resolves request ID: reuses trusted incoming X-Request-Id if valid,
 * otherwise generates a fresh cryptographically secure UUID v4.
 */
export function resolveRequestId(incomingHeader?: unknown): string {
  const validated = validateRequestId(incomingHeader);
  if (validated) {
    return validated;
  }
  return crypto.randomUUID();
}

export type LogSink = (event: StructuredLogEvent) => void;

export class StructuredLogger {
  private listeners: LogSink[] = [];
  private silent: boolean = false;
  private forceOutput: boolean = false;

  public addListener(fn: LogSink): () => void {
    this.listeners.push(fn);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== fn);
    };
  }

  public setSilent(silent: boolean): void {
    this.silent = silent;
  }

  public setForceOutput(force: boolean): void {
    this.forceOutput = force;
  }

  public log(level: LogLevel, message: string, context?: Record<string, any>): void {
    const event: StructuredLogEvent = {
      timestamp: new Date().toISOString(),
      level,
      message: sanitizeErrorMessage(message),
      ...sanitizeLogObject(context || {})
    };

    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {}
    }

    if (this.silent || (!this.forceOutput && process.env.NODE_ENV === 'test')) {
      return;
    }

    const serialized = JSON.stringify(event);
    if (level === 'error') {
      process.stderr.write(serialized + '\n');
    } else {
      process.stdout.write(serialized + '\n');
    }
  }

  public info(message: string, context?: Record<string, any>): void {
    this.log('info', message, context);
  }

  public warn(message: string, context?: Record<string, any>): void {
    this.log('warn', message, context);
  }

  public error(message: string, context?: Record<string, any>): void {
    this.log('error', message, context);
  }

  public debug(message: string, context?: Record<string, any>): void {
    this.log('debug', message, context);
  }
}

export const logger = new StructuredLogger();

/**
 * Canonical Client IP Extraction Helper
 * 
 * - When running behind Cloudflare / Render edge proxies where proxy trust is enabled,
 *   prefers the verified Cloudflare client-IP header ('CF-Connecting-IP') when present and valid.
 * - When proxy trust is disabled (trust proxy = false) or in direct socket connections without
 *   the Cloudflare header, strictly falls back to Express proxy-evaluated req.ip or socket remoteAddress.
 * - Rejects malformed / non-IP values and normalizes IPv4-mapped IPv6 addresses (::ffff:127.0.0.1 -> 127.0.0.1).
 */
export function extractClientIp(req: Request | any): string {
  if (!req) return '127.0.0.1';

  // If proxy trust is explicitly disabled on the app or via environment,
  // do not trust any proxy-supplied headers; fall back directly to socket remoteAddress.
  const isTrustProxyDisabled =
    req.app?.get?.('trust proxy') === false ||
    (typeof process !== 'undefined' && process.env.TRUST_PROXY?.toLowerCase() === 'false');

  if (!isTrustProxyDisabled) {
    const rawCfIp =
      req.headers?.['cf-connecting-ip'] ||
      (typeof req.get === 'function' ? req.get('cf-connecting-ip') : undefined);

    if (rawCfIp) {
      const str = Array.isArray(rawCfIp) ? rawCfIp[0] : String(rawCfIp);
      const candidate = str.split(',')[0].trim();
      if (candidate && net.isIP(candidate) !== 0) {
        return candidate.replace(/^::ffff:/, '');
      }
    }
  }

  const rawIp = req.ip || req.socket?.remoteAddress || '127.0.0.1';
  return typeof rawIp === 'string' ? rawIp.replace(/^::ffff:/, '') : '127.0.0.1';
}

/**
 * Express middleware for request correlation, monotonic timing, and structured logging.
 * - Assigns or validates X-Request-Id.
 * - Normalizes client IP via canonical extractClientIp().
 * - Sets res.locals.requestId and res.setHeader('X-Request-Id', requestId).
 * - Records monotonic start time using process.hrtime.bigint().
 * - Emits structured log event on completion for API routes or error responses.
 */
export function requestCorrelationMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const requestId = resolveRequestId(req.headers['x-request-id']);
  (req as any).id = requestId;
  (req as any).requestId = requestId;

  const clientIp = extractClientIp(req);
  (req as any).clientIp = clientIp;

  res.locals.requestId = requestId;
  res.setHeader('X-Request-Id', requestId);

  const startTime = process.hrtime.bigint();

  res.on('finish', () => {
    const durationMs =
      Math.round((Number(process.hrtime.bigint() - startTime) / 1_000_000) * 100) / 100;

    const isApiRoute = req.path.startsWith('/api');
    const isError = res.statusCode >= 400;

    if (isApiRoute || isError) {
      const level: LogLevel =
        res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info';

      logger.log(level, `HTTP ${req.method} ${req.path} completed with ${res.statusCode}`, {
        requestId,
        method: req.method,
        path: req.path,
        statusCode: res.statusCode,
        durationMs,
        clientIp
      });
    }
  });

  next();
}
