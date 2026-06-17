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
