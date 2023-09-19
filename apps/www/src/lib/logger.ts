import { ILogger } from "@luchyio/next"

export const logger: ILogger = {
  debug: (...params) => {
    if (process.env.NODE_ENV === "development" && process.env.DEBUG) {
      if (params[0] === "raw" && process.env.DEBUG !== "raw") return

      console.debug("[debug]", ...params)
    }
  },
  warn: (...params) => console.warn("[warn]", ...params),
  error: (...params) => console.error("[error]", ...params),
  info: (...params) => console.info("[info]", ...params),
}
