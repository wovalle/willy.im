import { createDrizzleClient, type DrizzleClient } from "../db/drizzle"
import { getAppEnv } from "./env"
import { createLogger, type Logger, type LogFields } from "./log"

export type ILogger = Logger

export type BaseServiceContext = {
  getAppEnv: typeof getAppEnv
  logger: ILogger
  db: DrizzleClient
}

export function createBaseContext(d1: D1Database, logFields: LogFields = {}): BaseServiceContext {
  return {
    db: createDrizzleClient(d1),
    logger: createLogger({ scope: "server", ...logFields }, getAppEnv("LOG_LEVEL")),
    getAppEnv,
  }
}
