import { z } from "zod"

const appEnvSchema = z.object({
  APP_ENV: z.enum(["development", "production"]).default("development"),
  BETTER_AUTH_URL: z.string().default("http://localhost:5173"),
  BETTER_AUTH_SECRET: z.string().default("dev-insecure-secret-change-me"),

  // Auth email sender. Optional locally — without it OTPs are logged to console.
  RESEND_TOKEN: z.string().optional(),
  EMAIL_FROM: z.string().default("willy.im <noreply@emails.willy.im>"),

  // Admin console + management API. Comma-separated allowlist of admin emails.
  ADMIN_EMAILS: z.string().default("hey@willy.im"),
  // Bearer token for the read-only management API (/api/v1/*). Optional.
  ADMIN_API_TOKEN: z.string().optional(),
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
