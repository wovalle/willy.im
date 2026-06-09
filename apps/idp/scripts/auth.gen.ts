import { betterAuth } from "better-auth"
import { drizzleAdapter } from "better-auth/adapters/drizzle"
import { emailOTP } from "better-auth/plugins/email-otp"
import { passkey } from "@better-auth/passkey"

/**
 * Schema-generation config ONLY. The real auth instance lives in
 * app/lib/auth.server.ts as a request-scoped factory, which the better-auth CLI
 * can't introspect. This mirror must carry the same plugins (and later, the same
 * additionalFields / organization config) so the generated schema stays correct.
 *
 * Regenerate with:  npm run auth:db:generate
 */
export const auth = betterAuth({
  database: drizzleAdapter({} as never, { provider: "sqlite" }),
  emailAndPassword: { enabled: false },
  plugins: [
    emailOTP({ sendVerificationOTP: async () => {} }),
    passkey(),
  ],
})
