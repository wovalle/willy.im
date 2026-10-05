import { z } from "zod"

/** The dev-only fallback secret. Allowed outside production; refused in it. */
const DEV_SECRET = "dev-insecure-secret-change-me"

const appEnvSchema = z.object({
  APP_ENV: z.enum(["development", "production"]).default("development"),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
  BETTER_AUTH_URL: z.string().default("http://localhost:5173"),
  // Signs session cookies and the OAuth authorize query, and ENCRYPTS the OIDC
  // private keys stored in D1. A dev fallback keeps `npm run dev` zero-config,
  // but the refinement below refuses it (or any too-short value) in production:
  // a missing secret there would silently fall back to a value committed to the
  // repo, so anyone reading the jwks table could sign tokens for every app.
  BETTER_AUTH_SECRET: z.string().default(DEV_SECRET),

  // Extra hostnames the IdP also serves (vanity domains, e.g. "idp.app1.com").
  // Comma-separated. A request on one of these gets that host as its issuer,
  // cookies, and passkey RP — first-party per domain, no cross-domain SSO.
  IDP_EXTRA_DOMAINS: z.string().default(""),

  // Auth email sender. Optional locally — without it OTPs are logged to console.
  RESEND_TOKEN: z.string().optional(),
  EMAIL_FROM: z.string().default("willy.im <noreply@emails.willy.im>"),

  // Admin console + management API. Comma-separated allowlist of admin emails.
  ADMIN_EMAILS: z.string().default("hey@willy.im"),

  // Discord, for self-service identity linking (/link/discord). The id is not a
  // secret and lives in wrangler.jsonc `vars`; the secret is a Worker secret.
  // BOTH optional: without them the provider is simply not registered and the
  // link page says so, rather than the Worker failing to boot over a feature
  // nobody in this deployment uses.
  DISCORD_CLIENT_ID: z.string().optional(),
  DISCORD_CLIENT_SECRET: z.string().optional(),

  // GlitchTip (bugs.romo.fyi, project `idp`) DSN — a Worker secret. Unset or
  // empty ⇒ nothing is reported (local dev, tests). See error-reporting.server.ts.
  GLITCHTIP_DSN: z.string().optional(),
}).superRefine((env, ctx) => {
  if (env.APP_ENV !== "production") return
  if (env.BETTER_AUTH_SECRET === DEV_SECRET || env.BETTER_AUTH_SECRET.length < 32) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["BETTER_AUTH_SECRET"],
      message:
        "BETTER_AUTH_SECRET must be set to a strong value (>= 32 chars) in production — " +
        "`wrangler secret put BETTER_AUTH_SECRET`.",
    })
  }
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
