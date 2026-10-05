import { eq } from "drizzle-orm"

import * as schema from "../db/schema"
import { clientDisplayName, clientHost, hostOf, UNNAMED_CLIENT } from "./client-display"
import { unwrapJson } from "./metadata"
import type { BaseServiceContext } from "./services"

/** What the consent screen says about the client asking for access. */
export type ConsentClient = {
  /** The headline: the registered name, or a readable fallback — never the client_id. */
  name: string
  /** Where the user will be sent back to, shown under the name; null when it adds nothing. */
  host: string | null
  /** The registered logo, https only. */
  icon: string | null
}

const httpsOnly = (url: string | null | undefined) => {
  try {
    return url && new URL(url).protocol === "https:" ? url : null
  } catch {
    return null
  }
}

/**
 * The client a consent request is for, by the `client_id` the plugin put on the
 * consent URL. Only public registration data is read — the same the plugin's
 * public-client endpoint exposes — so an unknown or forged id is just "An
 * application", not an error.
 */
export async function consentClient(
  ctx: BaseServiceContext,
  clientId: string | null,
  redirectUri: string | null,
): Promise<ConsentClient> {
  const [row] = clientId
    ? await ctx.db
        .select({
          name: schema.oauthClient.name,
          uri: schema.oauthClient.uri,
          icon: schema.oauthClient.icon,
          redirectUris: schema.oauthClient.redirectUris,
        })
        .from(schema.oauthClient)
        .where(eq(schema.oauthClient.clientId, clientId))
        .limit(1)
    : []
  if (!row) return { name: UNNAMED_CLIENT, host: null, icon: null }

  const raw = unwrapJson(row.redirectUris)
  const redirectUris = Array.isArray(raw) ? raw.filter((u): u is string => typeof u === "string") : []
  const client = { name: row.name, uri: row.uri, redirectUris }
  const name = clientDisplayName(client)
  // The redirect this request will actually use, when it is one the client
  // registered (the plugin already checked; this keeps the page honest anyway).
  const host =
    (redirectUri && redirectUris.includes(redirectUri) ? hostOf(redirectUri) : null) ?? clientHost(client)
  return { name, host: host === name ? null : host, icon: httpsOnly(row.icon) }
}
