/**
 * Small structured logger that works on both the Cloudflare Worker (server) and
 * in the browser. Emits one JSON line per event so `wrangler tail` and the
 * browser console stay greppable. Use `.child()` to bind request-scoped fields.
 */
export type LogFields = Record<string, unknown>
type Level = "debug" | "info" | "warn" | "error"

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

export function createLogger(base: LogFields = {}): Logger {
  return {
    debug: (msg, fields) => emit("debug", base, msg, fields),
    info: (msg, fields) => emit("info", base, msg, fields),
    warn: (msg, fields) => emit("warn", base, msg, fields),
    error: (msg, fields) => emit("error", base, msg, fields),
    child: (fields) => createLogger({ ...base, ...fields }),
  }
}

/** Browser-side logger. */
export const clientLog = createLogger({ scope: "client" })
