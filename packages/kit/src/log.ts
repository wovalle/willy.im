import {
  configureSync,
  getLogger as getLogTape,
  withContext as withLogTapeContext,
  type ContextLocalStorage,
  type LogLevel as LogTapeLevel,
  type Logger as LogTapeLogger,
  type LogRecord,
} from "@logtape/logtape"

/**
 * Structured logs on LogTape: one JSON line per event on stdout,
 * `{ ts, level, app, scope, msg, ...fields }`. No file sinks: rotation is the
 * platform's job (journald / docker on a server, Workers Logs on Cloudflare).
 * See README → Logging.
 */

export type LogLevel = "debug" | "info" | "warn" | "error"

/** The shape apps already pass around: a message, then fields, an error or anything else. */
export interface ILogger {
  debug(message: string, ...args: unknown[]): void
  info(message: string, ...args: unknown[]): void
  /** Same as `info`. */
  log(message: string, ...args: unknown[]): void
  warn(message: string, ...args: unknown[]): void
  error(message: string, ...args: unknown[]): void
}

export interface Logger extends ILogger {
  /** A logger whose every line carries `fields` too: `log.with({ thread, session })`. */
  with(fields: Record<string, unknown>): Logger
}

export type LogOptions = {
  /** The app's name, on every line. Default: `createApp`'s `name`, else "app". */
  app?: string
  /** The lowest level written. Default: `LOG_LEVEL`, else "info". */
  level?: LogLevel | string
  /**
   * One JSON line (false) or one readable line (true). Default: `LOG_FORMAT`
   * (`json` | `pretty`), else pretty only when `NODE_ENV` is set and isn't
   * `production`, and never on Workers.
   */
  pretty?: boolean
  /** Where lines go. Default: `console.log`, which is stdout on Bun/Node and Workers Logs on Cloudflare. */
  write?: (line: string) => void
  /**
   * What `withLogContext` stores context in. Default: `AsyncLocalStorage` when
   * the runtime has it (Bun, Node, Workers with `nodejs_compat`); without one,
   * `withLogContext` just runs its callback.
   */
  contextStorage?: ContextLocalStorage<Record<string, unknown>> | null
}

const LEVELS: Record<LogLevel, LogTapeLevel> = {
  debug: "debug",
  info: "info",
  warn: "warning",
  error: "error",
}
const OUT: Record<LogTapeLevel, string> = {
  trace: "debug",
  debug: "debug",
  info: "info",
  warning: "warn",
  error: "error",
  fatal: "error",
}

type Env = Record<string, string | undefined>
const env = (): Env => (globalThis as { process?: { env?: Env } }).process?.env ?? {}

const isWorkers = () =>
  (globalThis as { navigator?: { userAgent?: string } }).navigator?.userAgent ===
  "Cloudflare-Workers"

const parseLevel = (value: string | undefined): LogLevel => {
  const v = value?.trim().toLowerCase()
  if (v === "warning") return "warn"
  return v && v in LEVELS ? (v as LogLevel) : "info"
}

// Without a static `node:async_hooks` import, so the module loads on any runtime.
function defaultStorage(): ContextLocalStorage<Record<string, unknown>> | undefined {
  type Als = new () => ContextLocalStorage<Record<string, unknown>>
  const g = globalThis as {
    AsyncLocalStorage?: Als
    process?: { getBuiltinModule?: (id: string) => { AsyncLocalStorage?: Als } | undefined }
  }
  try {
    const Ctor =
      g.AsyncLocalStorage ?? g.process?.getBuiltinModule?.("node:async_hooks")?.AsyncLocalStorage
    return Ctor ? new Ctor() : undefined
  } catch {
    return undefined
  }
}

// ─── Serialization and redaction ────────────────────────────────────────────

const SECRET_KEY = /token|secret|password|authorization|cookie|api[-_]?key/i
const SECRET_VALUE = /\b(wat_)[A-Za-z0-9_-]+|\b(Bearer )[A-Za-z0-9._~+/=-]+/g
const REDACTED = "[REDACTED]"

const scrub = (s: string) =>
  s.replace(
    SECRET_VALUE,
    (_m, wat: string | undefined, bearer: string | undefined) => `${wat ?? bearer}${REDACTED}`,
  )

/**
 * A value made safe for one JSON line: errors become `{ message, stack, cause }`,
 * keys that look secret and `wat_…` / `Bearer …` values are redacted, cycles
 * and depth are cut. A secret-looking key keeps a number or boolean value
 * (`inputTokens: 1200` is a count, not a token).
 */
export function serialize(value: unknown, depth = 0, seen = new WeakSet<object>()): unknown {
  if (typeof value === "string") return scrub(value)
  if (typeof value === "bigint") return value.toString()
  if (typeof value === "function" || typeof value === "symbol") return undefined
  if (value === null || typeof value !== "object") return value
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString()
  if (seen.has(value)) return "[Circular]"
  if (depth >= 8) return "[Truncated]"
  seen.add(value)
  try {
    if (value instanceof Error) {
      const { message, stack, cause, name, ...rest } = value as Error & Record<string, unknown>
      return {
        ...(name !== "Error" && { name }),
        message: scrub(message),
        ...(stack !== undefined && { stack: scrub(stack) }),
        ...(cause !== undefined && { cause: serialize(cause, depth + 1, seen) }),
        ...(serialize(rest, depth + 1, seen) as object),
      }
    }
    // A thrown Response (kit's 400/403/404, an upstream fetch): its status, not its body.
    if (typeof Response !== "undefined" && value instanceof Response)
      return { status: value.status, ...(value.statusText && { statusText: value.statusText }) }
    if (Array.isArray(value)) return value.map((v) => serialize(v, depth + 1, seen) ?? null)
    if (value instanceof Map) return serialize(Object.fromEntries(value), depth, seen)
    if (value instanceof Set) return serialize([...value], depth, seen)
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value)) {
      out[k] =
        SECRET_KEY.test(k) && v != null && typeof v !== "number" && typeof v !== "boolean"
          ? REDACTED
          : serialize(v, depth + 1, seen)
    }
    return out
  } finally {
    seen.delete(value)
  }
}

// ─── Formatting ─────────────────────────────────────────────────────────────

const BASE = ["ts", "level", "app", "scope", "msg"] as const

const text = (parts: readonly unknown[]) =>
  parts
    .map((p) => (typeof p === "string" ? p : (JSON.stringify(serialize(p)) ?? String(p))))
    .join("")

/** The JSON object for one record. Fields never overwrite the base keys. */
export function toEntry(record: LogRecord, app: string): Record<string, unknown> {
  const base = {
    ts: new Date(record.timestamp).toISOString(),
    level: OUT[record.level],
    app,
    scope: record.category.join("."),
    msg: scrub(text(record.message)),
  }
  const fields = serialize(record.properties) as Record<string, unknown>
  for (const k of BASE) delete fields[k]
  return { ...base, ...fields }
}

const COLORS: Record<string, string> = {
  debug: "\x1b[90m",
  info: "\x1b[32m",
  warn: "\x1b[33m",
  error: "\x1b[31m",
}

const pretty = (entry: Record<string, unknown>) => {
  const { ts, level, app: _app, scope, msg, ...fields } = entry
  const time = String(ts).slice(11, 23)
  const lvl = String(level)
  let stack = ""
  const kv = Object.entries(fields).map(([k, v]) => {
    const err = v as { stack?: unknown } | null
    if (typeof err?.stack === "string") {
      stack += `\n${err.stack}`
      const { stack: _s, ...rest } = err as Record<string, unknown>
      v = rest
    }
    return `${k}=${typeof v === "string" ? v : JSON.stringify(v)}`
  })
  return `\x1b[90m${time}\x1b[0m ${COLORS[lvl] ?? ""}${lvl.toUpperCase().padEnd(5)}\x1b[0m \x1b[36m${scope}\x1b[0m ${msg}${kv.length ? ` \x1b[90m${kv.join(" ")}\x1b[0m` : ""}${stack}`
}

// ─── Configuration ──────────────────────────────────────────────────────────

let configured = false
let hasContext = false
let fallbackApp: string | undefined

/**
 * Configures logging for the process (or the Worker isolate). Call it once at
 * startup; calling it again replaces the configuration. Without a call, the
 * first line logged configures the defaults.
 *
 * ```ts
 * configureLog({ app: "bender", level: env.LOG_LEVEL })
 * ```
 */
export function configureLog(options: LogOptions = {}): void {
  const e = env()
  const app = options.app ?? fallbackApp ?? "app"
  const level = parseLevel(options.level ?? e.LOG_LEVEL)
  const format = e.LOG_FORMAT?.toLowerCase()
  const isPretty =
    options.pretty ??
    (format === "pretty"
      ? true
      : format === "json"
        ? false
        : !isWorkers() && e.NODE_ENV !== undefined && e.NODE_ENV !== "production")
  const write = options.write ?? ((line: string) => console.log(line))
  const storage =
    options.contextStorage === null ? undefined : (options.contextStorage ?? defaultStorage())
  configureSync({
    reset: true,
    sinks: {
      out: (record: LogRecord) => {
        const entry = toEntry(record, app)
        write(isPretty ? pretty(entry) : JSON.stringify(entry))
      },
    },
    loggers: [
      { category: [], sinks: ["out"], lowestLevel: LEVELS[level] },
      // LogTape's own warnings; its info lines are noise.
      { category: ["logtape", "meta"], lowestLevel: "warning" },
    ],
    ...(storage && { contextLocalStorage: storage }),
  })
  configured = true
  hasContext = storage !== undefined
}

/** The app name kit uses when the app never calls `configureLog`. */
export const defaultLogApp = (name: string | undefined) => {
  fallbackApp ??= name
}

const ensure = () => {
  if (!configured) configureLog()
}

// ─── Loggers ────────────────────────────────────────────────────────────────

const isPlain = (v: unknown): v is Record<string, unknown> => {
  if (v === null || typeof v !== "object" || Array.isArray(v)) return false
  const proto = Object.getPrototypeOf(v)
  return proto === Object.prototype || proto === null
}

/** `("msg", { a }, err, "x")` → fields `{ a, error: err, args: ["x"] }`. */
const toFields = (args: unknown[]) => {
  const fields: Record<string, unknown> = {}
  const rest: unknown[] = []
  for (const a of args) {
    if (isPlain(a)) Object.assign(fields, a)
    else if (a instanceof Error && fields.error === undefined) fields.error = a
    else rest.push(a)
  }
  if (rest.length) fields.args = rest
  return fields
}

// LogTape reads `{name}` in a message as a placeholder; kit's messages are literal.
const literal = (msg: string) => msg.replace(/[{}]/g, (b) => b + b)

const wrap = (lt: LogTapeLogger): Logger => {
  const emit =
    (level: "debug" | "info" | "warn" | "error") =>
    (msg: string, ...args: unknown[]) => {
      ensure()
      lt[level](literal(String(msg)), toFields(args))
    }
  return {
    debug: emit("debug"),
    info: emit("info"),
    log: emit("info"),
    warn: emit("warn"),
    error: emit("error"),
    with: (fields) => wrap(lt.with(fields)),
  }
}

/**
 * A logger for one part of the app: its `scope` on every line. Events are dotted
 * names, fields go in an object: `log.info("turn.done", { thread, ms })`.
 * An `Error` argument becomes the `error` field.
 */
export const getLogger = (scope: string | readonly string[]): Logger =>
  wrap(getLogTape(typeof scope === "string" ? scope.split(".") : scope))

/**
 * Runs `fn` with `fields` on every line logged inside it, across awaits:
 * `withLogContext({ request: id }, () => handle(req))`. Needs `AsyncLocalStorage`
 * (Bun, Node, Workers with `nodejs_compat`); elsewhere it just runs `fn`.
 * Pass fields explicitly with `log.with(...)` when in doubt.
 */
export const withLogContext = <T>(fields: Record<string, unknown>, fn: () => T): T => {
  ensure()
  return hasContext ? withLogTapeContext(fields, fn) : fn()
}

/** A logger that drops everything: for tests. */
export const nullLogger: Logger = {
  debug: () => {},
  info: () => {},
  log: () => {},
  warn: () => {},
  error: () => {},
  with: () => nullLogger,
}
