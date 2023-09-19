import { GeneratedAlways } from "kysely"

export interface AuthDb {
  auth_user: {
    id: GeneratedAlways<string>
    name: string | null
    email: string
    emailVerified: Date | null
    image: string | null
  }
  auth_account: {
    id: GeneratedAlways<string>
    userId: string
    type: string
    provider: string
    providerAccountId: string
    refresh_token: string | null
    access_token: string | null
    expires_at: number | null
    token_type: string | null
    scope: string | null
    id_token: string | null
    session_state: string | null
  }
  auth_session: {
    id: GeneratedAlways<string>
    userId: string
    sessionToken: string
    expires: Date
  }
  auth_verification_token: {
    identifier: string
    token: string
    expires: Date
  }
}
