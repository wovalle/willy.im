import type { DrizzleClient } from "../db/drizzle"
import { getAppEnv } from "./env"

export interface ILogger {
  info(message: string, ...args: unknown[]): void
  log(message: string, ...args: unknown[]): void
  error(message: string, ...args: unknown[]): void
  warn(message: string, ...args: unknown[]): void
}

// Console logger implementation
export const createConsoleLogger = (): ILogger => ({
  info: (message: string, ...args: unknown[]) => {
    // eslint-disable-next-line no-console
    console.log(`[INFO] ${message}`, ...args)
  },
  log: (message: string, ...args: unknown[]) => {
    // eslint-disable-next-line no-console
    console.log(`[LOG] ${message}`, ...args)
  },
  error: (message: string, ...args: unknown[]) => {
    // eslint-disable-next-line no-console
    console.error(`[ERROR] ${message}`, ...args)
  },
  warn: (message: string, ...args: unknown[]) => {
    // eslint-disable-next-line no-console
    console.warn(`[WARN] ${message}`, ...args)
  },
})

export type BaseServiceContext = {
  getAppEnv: typeof getAppEnv
  logger: ILogger
  db: DrizzleClient
}

export function declareCustomService<
  TExtra = object,
  TService = object,
  TDeps extends BaseServiceContext & TExtra = BaseServiceContext & TExtra,
>(
  options: { name: string; extra?: TExtra },
  factory: (context: TDeps) => TService,
): (context: BaseServiceContext) => TService {
  return (context: BaseServiceContext) => {
    const mergedContext = { ...context, ...(options.extra || {}) } as TDeps
    return factory(mergedContext)
  }
}

export function declareService<TService = object>(
  name: string,
  factory: (context: BaseServiceContext) => TService,
): (context: BaseServiceContext) => TService {
  return (context: BaseServiceContext) => {
    return declareCustomService(
      {
        name,
      },
      factory,
    )(context)
  }
}
