import { betterAuth } from "better-auth"
import { drizzleAdapter } from "@better-auth/drizzle-adapter/relations-v2"
import { declareService, type BaseServiceContext } from "./services"

export const createAuthService = declareService("auth", (context: BaseServiceContext) => {
  return betterAuth({
    appName: "willy.im",
    basePath: "/auth",
    secret: context.getAppEnv("BETTER_AUTH_SECRET"),
    url: context.getAppEnv("BETTER_AUTH_URL"),
    database: drizzleAdapter(context.db, {
      provider: "sqlite",
    }),
    socialProviders: {
      google: {
        clientId: context.getAppEnv("GOOGLE_CLIENT_ID"),
        clientSecret: context.getAppEnv("GOOGLE_CLIENT_SECRET"),
        accessType: "offline",
        prompt: "select_account consent",
        scope: [
          // "openid",
          // "https://www.googleapis.com/auth/userinfo.email",
          // "https://www.googleapis.com/auth/userinfo.profile",
          "https://www.googleapis.com/auth/youtube.readonly",
        ],
        // disableDefaultScope: true,
      },
    },
  })
})

export type AuthService = ReturnType<typeof createAuthService>

/**
 * A valid (refreshed if needed) access token for the user's linked Google
 * account. Better Auth picks the account by its row id, so resolve that first.
 */
export async function getGoogleAccessToken(auth: AuthService, userId: string) {
  const { internalAdapter } = await auth.$context
  const account = (await internalAdapter.findAccounts(userId)).find((a) => a.providerId === "google")
  if (!account) return { accessToken: undefined }
  return auth.api.getAccessToken({ body: { accountId: account.id, userId } })
}
