import { required } from "@willyim/common"
import { getAuthDb } from "../../db/kysely"

const authDb = getAuthDb()

export const getMainAccountTokens = async () => {
  return await authDb
    .selectFrom("auth_account")
    .select(["access_token", "refresh_token"])
    .where(
      "id",
      "=",
      required(process.env.AUTH_MAIN_ACCOUNT_ID, "AUTH_MAIN_ACCOUNT_ID is required")
    )
    .executeTakeFirstOrThrow()
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
}
