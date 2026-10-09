import { createAuthClient } from "better-auth/client"
import { emailOTPClient } from "better-auth/client/plugins"
import { passkeyClient } from "@better-auth/passkey/client"
import { oauthProviderClient } from "@better-auth/oauth-provider/client"

export const authClient = createAuthClient({
  basePath: "/auth",
  // oauthProviderClient auto-carries the signed authorize query through sign-in
  // and exposes oauth2.consent for the consent page.
  plugins: [emailOTPClient(), passkeyClient(), oauthProviderClient()],
})

type AuthError = { message?: string; error?: string; code?: string; status?: number; statusText?: string }

/**
 * What to tell a person about a failed auth call. Some errors carry no
 * `message` (the oauth-provider's `{ error: "invalid_signature" }`), and a bare
 * fallback then hides the cause — so the code and status ride along.
 */
export function authErrorText(error: AuthError, fallback: string): string {
  if (error.message) return error.message
  if (error.error === "invalid_signature") return "This sign-in request expired. Reload the page and try again."
  const detail = error.code ?? error.error ?? [error.status, error.statusText].filter(Boolean).join(" ")
  return detail ? `${fallback} (${detail})` : fallback
}
