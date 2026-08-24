import { eq } from "drizzle-orm"
import { betterAuth } from "better-auth"
import { APIError } from "better-auth/api"
import { drizzleAdapter } from "better-auth/adapters/drizzle"
import { admin } from "better-auth/plugins/admin"
import { emailOTP } from "better-auth/plugins/email-otp"
import { jwt } from "better-auth/plugins/jwt"
import { organization } from "better-auth/plugins/organization"
import { passkey } from "@better-auth/passkey"
import { oauthProvider } from "@better-auth/oauth-provider"
import { Resend } from "resend"

import * as schema from "../db/schema"
import { accessTokenClaimsFor, customClaimsFor, pictureClaimFor } from "./claims.server"
import { hashClientSecret } from "./client-secret.server"
import { claimInvitationsForUser } from "./members.server"
import type { BaseServiceContext } from "./services"
import {
  SIGNUP_NOT_ALLOWED_MESSAGE,
  clientIdFromSignInRequest,
  decideSignup,
} from "./signup.server"

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

/**
 * Builds the auth service for one request. `requestUrl` makes the IdP
 * host-aware: when the request arrives on a configured vanity domain
 * (IDP_EXTRA_DOMAINS, e.g. idp.app1.com CNAME'd here), that host becomes the
 * issuer, cookie domain, and passkey RP — first-party auth per domain. Unknown
 * hosts fall back to the canonical BETTER_AUTH_URL. Signing keys and the user
 * store are shared, so an account works on every domain; sessions and passkeys
 * are per-domain by design (no cross-domain SSO).
 */
export function createAuthService(
  context: BaseServiceContext,
  requestUrl?: string,
  options: {
    /**
     * Every resource URI any application declares (claims.server allResources),
     * loaded by the worker before this is built. The token endpoint refuses a
     * `resource` outside this list, so an access token can only ever be minted
     * for an audience some registered app actually is.
     */
    audiences?: string[]
  } = {},
) {
  const env = context.getAppEnv()
  const isProd = env.APP_ENV === "production"
  const canonical = new URL(env.BETTER_AUTH_URL)

  const extraHosts = env.IDP_EXTRA_DOMAINS.split(",")
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean)
  const allowedHosts = new Set([canonical.host, ...extraHosts])

  let url = canonical
  if (requestUrl) {
    const requested = new URL(requestUrl)
    if (requested.host !== canonical.host && allowedHosts.has(requested.host.toLowerCase())) {
      // Vanity domains are always https (Cloudflare/Caddy terminate TLS).
      url = new URL(`https://${requested.host}`)
    }
  }

  // IdP-level superadmins (static allowlist). They — and only they — get the
  // Better Auth `admin` role, which is what gates impersonation. App-scoped
  // impersonation by app-admins is intentionally NOT enabled here: the admin
  // plugin's authorization is global, so granting app-admins the role would let
  // them call /auth/admin/impersonate-user directly and bypass app-scoping.
  const superadminEmails = env.ADMIN_EMAILS.split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean)
  const isSuperadminEmail = (email?: string | null) =>
    !!email && superadminEmails.includes(email.toLowerCase())

  // In dev, trust common localhost ports so a default `npm run dev` (5173) works
  // even if BETTER_AUTH_URL points elsewhere. Prod trusts the resolved origin
  // plus every configured IdP domain (a vanity-domain login posts to itself).
  const prodOrigins = [...new Set([url.origin, ...extraHosts.map((h) => `https://${h}`)])]
  const trustedOrigins = isProd
    ? prodOrigins
    : [...new Set([...prodOrigins, "http://localhost:5173", "http://localhost:9100"])]

  return betterAuth({
    appName: "willy.im",
    basePath: "/auth",
    baseURL: url.origin,
    secret: env.BETTER_AUTH_SECRET,
    trustedOrigins,
    database: drizzleAdapter(context.db, { provider: "sqlite", schema }),
    session: {
      expiresIn: 60 * 60 * 24 * 30, // 30 days
      updateAge: 60 * 60 * 24, // refresh daily
    },
    databaseHooks: {
      // The `allow_signup` gate. This is the only place a willy.im account comes
      // into existence, so it is the only place the per-app open-signup flag can
      // be enforced (see signup.server.ts for the exact semantics). Throwing here
      // aborts before the user row is written — no orphan account.
      user: {
        create: {
          before: async (user, endpoint) => {
            const clientId = clientIdFromSignInRequest({
              body: endpoint?.body,
              query: endpoint?.query,
              url: endpoint?.request?.url,
            })
            const decision = await decideSignup(context, { clientId, email: user.email })
            if (!decision.allowed) {
              context.logger.warn("signup.rejected", { app: decision.app, email: user.email })
              throw new APIError("FORBIDDEN", { message: SIGNUP_NOT_ALLOWED_MESSAGE })
            }
          },
        },
      },
      // On every new session, claim any pending app invitations addressed to the
      // signed-in user's (verified) email — INVITED → MEMBER. Runs regardless of
      // entry path (console or OAuth), so membership exists before id_token claims
      // resolve. Best-effort: a failure here must not block sign-in.
      session: {
        create: {
          after: async (session) => {
            try {
              const [u] = await context.db
                .select({ id: schema.user.id, email: schema.user.email, role: schema.user.role })
                .from(schema.user)
                .where(eq(schema.user.id, session.userId))
                .limit(1)
              if (u) {
                await claimInvitationsForUser(context, u)
                // Keep the Better Auth admin role in sync with the superadmin
                // allowlist — idempotent, so existing admins are backfilled on
                // their next sign-in (and a removed email loses the role).
                const shouldBeAdmin = isSuperadminEmail(u.email)
                if (shouldBeAdmin && u.role !== "admin") {
                  await context.db
                    .update(schema.user)
                    .set({ role: "admin" })
                    .where(eq(schema.user.id, u.id))
                } else if (!shouldBeAdmin && u.role === "admin") {
                  await context.db
                    .update(schema.user)
                    .set({ role: null })
                    .where(eq(schema.user.id, u.id))
                }
              }
            } catch (err) {
              context.logger.warn("invites.claim_failed", {
                userId: session.userId,
                error: err instanceof Error ? err.message : String(err),
              })
            }
          },
        },
      },
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
      // Workspaces = organizations, each scoped to one application via
      // applicationId. Membership + roles + invitations come for free; consumer
      // apps map roles -> permissions locally via packages/rbac.
      organization({
        allowUserToCreateOrganization: true,
        schema: {
          organization: {
            additionalFields: {
              applicationId: { type: "string", required: false, input: true },
            },
          },
        },
      }),
      // OIDC signing keys for id_tokens issued by the OAuth provider.
      jwt(),
      // Turns willy.im into an OAuth 2.1 / OIDC provider so other apps can
      // "Login with willy.im". Login + consent are handled by our own pages.
      oauthProvider({
        loginPage: "/login",
        consentPage: "/consent",
        // Same hasher the plugin's "hashed" default uses (SHA-256 -> base64url,
        // no padding) — but ours, so our direct client inserts and the plugin's
        // own writes/verifies can never drift apart. `verify` is omitted on
        // purpose: the plugin then hashes-and-constant-time-compares.
        storeClientSecret: { hash: hashClientSecret },
        // We serve the RFC 8414 root metadata ourselves (routes/well-known/*),
        // so silence Better Auth's "ensure it exists" startup warnings.
        silenceWarnings: { oauthAuthServerConfig: true, openidConfig: true },
        // Each OAuth client is tagged with metadata.app (its application key).
        // We surface only that application's workspaces + roles as a claim.
        customIdTokenClaims: async ({ user, metadata }) => ({
          // Guaranteed, so no consumer needs an avatar fallback of its own.
          ...pictureClaimFor(user, url.origin),
          ...(await customClaimsFor(context.db, user.id, metadata)),
        }),
        // ── MCP / resource servers ──────────────────────────────────────────
        // An MCP client (Claude, Claude Code, …) discovers this server from the
        // resource's protected-resource metadata, registers itself (RFC 7591,
        // anonymously — it is a public client with PKCE), and asks for a token
        // with `resource=<the MCP url>` (RFC 8707). The plugin then mints a JWT
        // access token with that audience, and the claims below stamp the
        // user's permissions FOR THE APP THAT OWNS THE RESOURCE on it — so the
        // resource server verifies one signature and reads one claim.
        allowDynamicClientRegistration: true,
        allowUnauthenticatedClientRegistration: true,
        clientRegistrationDefaultScopes: ["openid", "profile", "email", "offline_access"],
        validAudiences: [url.origin + "/auth", ...(options.audiences ?? [])],
        customAccessTokenClaims: ({ user, resource, metadata }) =>
          user ? accessTokenClaimsFor(context.db, user.id, resource, metadata) : {},
        // Same claims on /userinfo, so apps that refresh server-side (or skip
        // id_token parsing) still see workspaces/permissions and — crucially —
        // a LIVE `act` claim while an admin is impersonating the user, letting
        // them tag audit logs per-request. The hook has no client metadata, so
        // resolve the client from the access token's client_id/azp/aud.
        customUserInfoClaims: async ({ user, jwt }) => {
          // Independent of the client — every early return below still carries it.
          const picture = pictureClaimFor(user, url.origin)
          const raw = jwt.client_id ?? jwt.azp ?? jwt.aud
          const clientId = Array.isArray(raw) ? raw[0] : raw
          if (typeof clientId !== "string" || !clientId) return picture
          const [client] = await context.db
            .select({ metadata: schema.oauthClient.metadata })
            .from(schema.oauthClient)
            .where(eq(schema.oauthClient.clientId, clientId))
            .limit(1)
          if (!client) return picture
          let metadata: unknown = client.metadata
          if (typeof metadata === "string") {
            try {
              metadata = JSON.parse(metadata)
            } catch {
              return picture
            }
          }
          return { ...picture, ...(await customClaimsFor(context.db, user.id, metadata)) }
        },
      }),
      // Impersonation. Only users with the `admin` role (= superadmin allowlist,
      // synced above) may impersonate; impersonation sessions last 1h. App-scoped
      // impersonation by app-admins is enforced in our own route, not here.
      admin({ impersonationSessionDuration: 60 * 60 }),
    ],
  })
}

export type AuthService = ReturnType<typeof createAuthService>
export type User = AuthService["$Infer"]["Session"]["user"]
export type Session = AuthService["$Infer"]["Session"]["session"]
