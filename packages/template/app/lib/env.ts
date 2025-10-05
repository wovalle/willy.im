import { z } from "zod"

const appEnvSchema = z.object({
  GOOGLE_CLIENT_ID: z.string(),
  GOOGLE_CLIENT_SECRET: z.string(),
  BETTER_AUTH_SECRET: z.string(),
  BETTER_AUTH_URL: z.string(),

  GOODREADS_KEY: z.string(),

  SPOTIFY_CLIENT_ID: z.string(),
  SPOTIFY_CLIENT_SECRET: z.string(),
  SPOTIFY_REFRESH_TOKEN: z.string(),

  INTERNAL_TOKEN: z.string(),
  STATIC_ACCOUNT_ID: z.string(),
})

export type AppEnv = z.infer<typeof appEnvSchema>

export function getAppEnv(): AppEnv
export function getAppEnv<K extends keyof AppEnv>(slice: K): AppEnv[K]
export function getAppEnv(slice?: keyof AppEnv) {
  const env = process.env
  const parsedEnv = appEnvSchema.parse(env)

  if (slice) {
    return parsedEnv[slice]
  }

  return parsedEnv
}
