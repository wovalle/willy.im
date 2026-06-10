/**
 * Small structured logger that works on both the Cloudflare Worker (server) and
 * in the browser. Emits one JSON line per event so `wrangler tail` and the
 * browser console stay greppable. Use `.child()` to bind request-scoped fields.
 */
export type LogFields = Record<string, unknown>
export type Level = "debug" | "info" | "warn" | "error"

const RANK: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 }

export interface Logger {
  debug(msg: string, fields?: LogFields): void
  info(msg: string, fields?: LogFields): void
  warn(msg: string, fields?: LogFields): void
  error(msg: string, fields?: LogFields): void
  child(fields: LogFields): Logger
}

function emit(level: Level, base: LogFields, msg: string, fields?: LogFields) {
  const line = JSON.stringify({
    t: new Date().toISOString(),
    level,
    msg,
    ...base,
    ...fields,
  })
  if (level === "error") console.error(line)
  else if (level === "warn") console.warn(line)
  else console.log(line)
}

export function createLogger(base: LogFields = {}, minLevel: Level = "info"): Logger {
  const threshold = RANK[minLevel]
  const at = (level: Level, msg: string, fields?: LogFields) => {
    if (RANK[level] >= threshold) emit(level, base, msg, fields)
  }
  return {
    debug: (msg, fields) => at("debug", msg, fields),
    info: (msg, fields) => at("info", msg, fields),
    warn: (msg, fields) => at("warn", msg, fields),
    error: (msg, fields) => at("error", msg, fields),
    child: (fields) => createLogger({ ...base, ...fields }, minLevel),
  }
}

/** Browser-side logger. */
export const clientLog = createLogger({ scope: "client" })
