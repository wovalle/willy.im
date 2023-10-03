import { required } from "@willyim/common"
import { NextAuthOptions } from "next-auth"
import GoogleProvider from "next-auth/providers/google"
import { getAuthDb } from "../../../../db/kysely"
import { updateMainAccount } from "../../../../lib/queries/auth"
import { KyselyAdapter } from "../kyselyAuthAdapter"

const authDb = getAuthDb()

export const authOptions: NextAuthOptions = {
  // debug: true,
  adapter: KyselyAdapter(authDb),
  secret: required(process.env.NEXT_AUTH_SECRET, "NEXT_AUTH_SECRET is required"),
  providers: [
    GoogleProvider({
      clientId: required(process.env.GOOGLE_ID, "GOOGLE_ID is required"),
      clientSecret: required(process.env.GOOGLE_SECRET, "GOOGLE_SECRET is required"),
      authorization: {
        params: {
          access_type: "offline",
          prompt: "consent",
          scope: [
            "openid",
            "https://www.googleapis.com/auth/userinfo.email",
            "https://www.googleapis.com/auth/userinfo.profile",
            "https://www.googleapis.com/auth/youtube.readonly",
          ].join(" "),
        },
      },
    }),
  ],
  callbacks: {
    async signIn({ account }) {
      if (account) {
        await updateMainAccount({
          access_token: account.access_token,
          refresh_token: account.refresh_token,
          expires_at: account.expires_at,
        })
      }
      return true
    },
  },
}
