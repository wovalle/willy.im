import { ILogger } from "@luchyio/next"

const deploymentUrl = process.env.NEXT_PUBLIC_DEPLOYMENT_URL ?? process.env.NEXT_PUBLIC_VERCEL_URL

export const baseUrl =
  process.env.NODE_ENV === "development"
    ? "http://localhost:3000"
    : `https://${deploymentUrl ?? "willy.im"}`

export const basePath = "/api/luchy"

export const logger: ILogger = {
  debug: (...params) =>
    process.env.NODE_ENV === "development" || process.env.DEBUG
      ? console.log("debug", ...params)
      : () => {},
  warn: (...params) => console.warn("[warn]", ...params),
  error: (...params) => console.error("[error]", ...params),
  info: (...params) => console.info("[info]", ...params),
}
