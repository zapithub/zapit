// ZAPIT — Structured Logger (Phase 5)
// World-class: JSON lines, requestId, level, no PII, pluggable to pino/OpenTelemetry later.
// Usage: import { logger } from './src/utils/logger.js'; logger.info({ reqId, msg: '...' })

const LEVELS = { debug:10, info:20, warn:30, error:40 };
const currentLevel = (process.env.LOG_LEVEL || (process.env.NODE_ENV === 'production' ? 'info' : 'debug'));

function shouldLog(level) { return (LEVELS[level] ?? 20) >= (LEVELS[currentLevel] ?? 20); }

function redact(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  const copy = { ...obj };
  for (const k of ['password','password_hash','access_token','refresh_token','wa_access_token','paystack_secret_key','authorization']) {
    if (k in copy) copy[k] = '[REDACTED]';
  }
  // Redact email partially for PII
  if (copy.email && typeof copy.email === 'string') {
    const [a,b] = copy.email.split('@');
    if (b) copy.email = a.slice(0,2) + '***@' + b;
  }
  return copy;
}

function log(level, fields) {
  if (!shouldLog(level)) return;
  const entry = {
    level,
    time: new Date().toISOString(),
    ...redact(fields),
  };
  const line = JSON.stringify(entry);
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
}

export const logger = {
  debug: (fields) => log('debug', fields),
  info:  (fields) => log('info', fields),
  warn:  (fields) => log('warn', fields),
  error: (fields) => log('error', fields),
  child: (extra) => ({
    debug: (f) => log('debug', { ...extra, ...f }),
    info:  (f) => log('info',  { ...extra, ...f }),
    warn:  (f) => log('warn',  { ...extra, ...f }),
    error: (f) => log('error', { ...extra, ...f }),
  })
};
