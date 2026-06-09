import { betterAuth } from "better-auth"
import { drizzleAdapter } from "better-auth/adapters/drizzle"
import { emailOTP } from "better-auth/plugins/email-otp"
import { jwt } from "better-auth/plugins/jwt"
import { passkey } from "@better-auth/passkey"
import { oauthProvider } from "@better-auth/oauth-provider"
import { Resend } from "resend"

import * as schema from "../db/schema"
import type { BaseServiceContext } from "./services"

/**
 * Builds the sign-in email. Contains both the 6-digit code (type it) and a
 * sign-in link that carries the code (click it) — one email, both UX paths.
 */
function renderOtpEmail(baseUrl: string, email: string, otp: string) {
  const link = `${baseUrl}/login/verify?email=${encodeURIComponent(email)}&code=${otp}`
  return {
    subject: `${otp} is your willy.im sign-in code`,
    html: `<!DOCTYPE html><html><body style="font-family:system-ui,sans-serif;max-width:32rem;margin:0 auto;padding:1.5rem;color:#0a0a0a;">
      <p>Your willy.im sign-in code:</p>
      <p style="font-size:1.75rem;font-weight:700;letter-spacing:0.25em;margin:0.5rem 0;">${otp}</p>
      <p>Or click to sign in instantly:</p>
      <p><a href="${link}" style="display:inline-block;background:#0a0a0a;color:#fafafa;padding:12px 24px;text-decoration:none;border-radius:8px;margin:8px 0;">Sign in to willy.im</a></p>
      <p style="color:#666;font-size:14px;">This code expires in 10 minutes. If you didn't request it, ignore this email.</p>
    </body></html>`,
  }
}

export function createAuthService(context: BaseServiceContext) {
  const env = context.getAppEnv()
  const isProd = env.APP_ENV === "production"
  const url = new URL(env.BETTER_AUTH_URL)

  return betterAuth({
    appName: "willy.im",
    basePath: "/auth",
    baseURL: url.origin,
    secret: env.BETTER_AUTH_SECRET,
    trustedOrigins: [url.origin],
    database: drizzleAdapter(context.db, { provider: "sqlite", schema }),
    session: {
      expiresIn: 60 * 60 * 24 * 30, // 30 days
      updateAge: 60 * 60 * 24, // refresh daily
    },
    plugins: [
      emailOTP({
        otpLength: 6,
        expiresIn: 60 * 10,
        async sendVerificationOTP({ email, otp }) {
          const { subject, html } = renderOtpEmail(url.origin, email, otp)

          if (!isProd || !env.RESEND_TOKEN) {
            context.logger.info(`[auth] OTP for ${email}: ${otp}`)
            context.logger.info(`[auth] sign-in link: ${url.origin}/login/verify?email=${encodeURIComponent(email)}&code=${otp}`)
            return
          }

          const resend = new Resend(env.RESEND_TOKEN)
          await resend.emails.send({ from: env.EMAIL_FROM, to: email, subject, html })
        },
      }),
      passkey({
        rpName: "willy.im",
        rpID: url.hostname,
        origin: url.origin,
      }),
      // OIDC signing keys for id_tokens issued by the OAuth provider.
      jwt(),
      // Turns willy.im into an OAuth 2.1 / OIDC provider so other apps can
      // "Login with willy.im". Login + consent are handled by our own pages.
      oauthProvider({
        loginPage: "/login",
        consentPage: "/consent",
        storeClientSecret: "hashed",
      }),
    ],
  })
}

export type AuthService = ReturnType<typeof createAuthService>
export type User = AuthService["$Infer"]["Session"]["user"]
export type Session = AuthService["$Infer"]["Session"]["session"]
