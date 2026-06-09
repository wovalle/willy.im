import { createDrizzleClient, type DrizzleClient } from "../db/drizzle"
import { getAppEnv } from "./env"

export interface ILogger {
  info(message: string, ...args: unknown[]): void
  log(message: string, ...args: unknown[]): void
  error(message: string, ...args: unknown[]): void
  warn(message: string, ...args: unknown[]): void
}

export const createConsoleLogger = (): ILogger => ({
  info: (message: string, ...args: unknown[]) => {
    console.log(`[INFO] ${message}`, ...args)
  },
  log: (message: string, ...args: unknown[]) => {
    console.log(`[LOG] ${message}`, ...args)
  },
  error: (message: string, ...args: unknown[]) => {
    console.error(`[ERROR] ${message}`, ...args)
  },
  warn: (message: string, ...args: unknown[]) => {
    console.warn(`[WARN] ${message}`, ...args)
  },
})

export type BaseServiceContext = {
  getAppEnv: typeof getAppEnv
  logger: ILogger
  db: DrizzleClient
}

export function createBaseContext(d1: D1Database): BaseServiceContext {
  return {
    db: createDrizzleClient(d1),
    logger: createConsoleLogger(),
    getAppEnv,
  }
}
