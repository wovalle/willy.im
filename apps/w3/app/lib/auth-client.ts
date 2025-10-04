import { createAuthClient } from "better-auth/client"

export const authClient = createAuthClient({
  basePath: "/auth",
})

export const signIn = async () => {
  const data = await authClient.signIn.social({
    provider: "google",
  })
}
