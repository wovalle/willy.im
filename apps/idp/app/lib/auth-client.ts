import { createAuthClient } from "better-auth/client"
import { emailOTPClient } from "better-auth/client/plugins"
import { passkeyClient } from "@better-auth/passkey/client"

export const authClient = createAuthClient({
  basePath: "/auth",
  plugins: [emailOTPClient(), passkeyClient()],
})
