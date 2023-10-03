import { required } from "@willyim/common"
import { getAuthDb } from "../../db/kysely"

const authDb = getAuthDb()

export const getMainAccountTokens = async () => {
  const tokens = await authDb
    .selectFrom("auth_account")
    .select(["access_token", "refresh_token"])
    .where(
      "id",
      "=",
      required(process.env.AUTH_MAIN_ACCOUNT_ID, "AUTH_MAIN_ACCOUNT_ID is required")
    )
    .executeTakeFirstOrThrow()

  return tokens
}

export const updateMainAccountAccessToken = async (newToken: string) => {
  return await authDb
    .updateTable("auth_account")
    .set({
      access_token: newToken,
    })
    .where(
      "id",
      "=",
      required(process.env.AUTH_MAIN_ACCOUNT_ID, "AUTH_MAIN_ACCOUNT_ID is required")
    )
    .executeTakeFirstOrThrow()
}

export const updateMainAccount = async (opts: {
  access_token: string | undefined
  refresh_token: string | undefined
  expires_at: number | undefined
}) => {
  return await authDb
    .updateTable("auth_account")
    .set({
      access_token: opts.access_token,
      refresh_token: opts.refresh_token,
      expires_at: opts.expires_at,
    })
    .where(
      "id",
      "=",
      required(process.env.AUTH_MAIN_ACCOUNT_ID, "AUTH_MAIN_ACCOUNT_ID is required")
    )
    .executeTakeFirstOrThrow()
}
