import { ILogger } from "@luchyio/next"

export const logger: ILogger = {
  debug: (...params) =>
    process.env.NODE_ENV === "development" && process.env.DEBUG
      ? console.log("debug", ...params)
      : () => {},
  warn: (...params) => console.warn("[warn]", ...params),
  error: (...params) => console.error("[error]", ...params),
  info: (...params) => console.info("[info]", ...params),
}
