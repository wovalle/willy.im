import { betterAuth } from "better-auth"
import { drizzleAdapter } from "@better-auth/drizzle-adapter/relations-v2"

/**
 * Schema-generation config ONLY. The real auth instance is built per request in
 * app/lib/auth.server.ts, which the better-auth CLI can't introspect; keep this
 * mirror's database-affecting options in step with it.
 *
 * Regenerate with:  npm run auth:db:generate
 */
export const auth = betterAuth({
  baseURL: "http://localhost:5173",
  secret: "schema-gen-only",
  database: drizzleAdapter({} as never, { provider: "sqlite" }),
  socialProviders: {
    google: { clientId: "schema-gen-only", clientSecret: "schema-gen-only" },
  },
})
