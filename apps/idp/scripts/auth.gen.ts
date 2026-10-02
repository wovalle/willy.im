import { betterAuth, type BetterAuthPlugin } from "better-auth"
import { drizzleAdapter } from "@better-auth/drizzle-adapter/relations-v2"
import { admin } from "better-auth/plugins/admin"
import { emailOTP } from "better-auth/plugins/email-otp"
import { jwt } from "better-auth/plugins/jwt"
import { organization } from "better-auth/plugins/organization"
import { passkey } from "@better-auth/passkey"
import { oauthProvider } from "@better-auth/oauth-provider"

/**
 * Schema-generation config ONLY. The real auth instance lives in
 * app/lib/auth.server.ts as a request-scoped factory, which the better-auth CLI
 * can't introspect. This mirror must carry the same plugins (and later, the same
 * additionalFields / organization config) so the generated schema stays correct.
 *
 * Regenerate with:  npm run auth:db:generate
 */
/**
 * DDL-only additions for the generated schema. Every unique column Better Auth
 * declares with `.unique()` already exists in D1 as a named unique INDEX
 * (`<table>_<column>_unique`, from drizzle-kit 0.x). drizzle-kit v1 models
 * `.unique()` as a table constraint, which SQLite can only add by rebuilding the
 * table — and on D1 a rebuild of `user`/`oauth_client`/… cascades deletes into
 * every child table. Declaring the existing indexes by name makes the schema
 * match the database exactly, so drizzle-kit generates no rebuild.
 */
const existingUniqueIndexes = {
  id: "existing-unique-indexes",
  schema: {
    user: { fields: {}, indexes: [{ name: "user_email_unique", fields: ["email"], unique: true }] },
    session: {
      fields: {},
      indexes: [{ name: "session_token_unique", fields: ["token"], unique: true }],
    },
    // Better Auth builds its own rate-limit table after plugin tables and drops
    // their indexes, so the table is declared here in full instead of through
    // `rateLimit.storage` (same columns as Better Auth's, plus the named index).
    rateLimit: {
      fields: {
        key: { type: "string", unique: true, required: true },
        count: { type: "number", required: true },
        lastRequest: { type: "number", bigint: true, required: true },
      },
      indexes: [{ name: "rate_limit_key_unique", fields: ["key"], unique: true }],
    },
    oauthClient: {
      fields: {},
      indexes: [{ name: "oauth_client_client_id_unique", fields: ["clientId"], unique: true }],
    },
    oauthAccessToken: {
      fields: {},
      indexes: [{ name: "oauth_access_token_token_unique", fields: ["token"], unique: true }],
    },
    oauthRefreshToken: {
      fields: {},
      indexes: [{ name: "oauth_refresh_token_token_unique", fields: ["token"], unique: true }],
    },
  },
} satisfies BetterAuthPlugin

export const auth = betterAuth({
  baseURL: "http://localhost:5173",
  secret: "schema-gen-only",
  database: drizzleAdapter({} as never, { provider: "sqlite" }),
  emailAndPassword: { enabled: false },
  plugins: [
    emailOTP({ sendVerificationOTP: async () => {} }),
    passkey(),
    organization({
      schema: {
        organization: {
          additionalFields: {
            applicationId: { type: "string", required: false, input: true },
          },
        },
      },
    }),
    jwt(),
    oauthProvider({ loginPage: "/login", consentPage: "/consent", storeClientSecret: "hashed" }),
    // Impersonation (+ role/ban columns). Superadmin-scoped; see auth.server.ts.
    admin(),
    existingUniqueIndexes,
  ],
})
