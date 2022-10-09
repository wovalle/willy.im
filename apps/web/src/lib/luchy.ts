import { ILogger } from "@luchyio/next"

// TODO: can we do better?
export const baseUrl =
  process.env.NODE_ENV === "development" ? "http://localhost:3000" : "https://willy.im"

export const basePath = "/api/luchy"

export const logger: ILogger = {
  debug: (...params) => process.env.NODE_ENV === 'development' ? console.log(...params) : () => {},
  warn: (...params) => console.warn("[warn]", ...params),
  error: (...params) => console.error("[error]", ...params),
  info: (...params) => console.info("[info]", ...params),
}
