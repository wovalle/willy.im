import { z } from "zod"

/**
 * Phase 1 env surface is intentionally minimal. Auth secrets (BETTER_AUTH_SECRET,
 * GOOGLE_CLIENT_ID/SECRET, RESEND_API_KEY, …) are added in Phase 2.
 */
const appEnvSchema = z.object({
  BETTER_AUTH_URL: z.string().default("http://localhost:5173"),
})

export type AppEnv = z.infer<typeof appEnvSchema>

export function getAppEnv(): AppEnv
export function getAppEnv<K extends keyof AppEnv>(slice: K): AppEnv[K]
export function getAppEnv(slice?: keyof AppEnv) {
  const parsedEnv = appEnvSchema.parse(process.env)

  if (slice) {
    return parsedEnv[slice]
  }

  return parsedEnv
}
