/**
 * How an OAuth client is named to a person. Its registered `name` when it has
 * one; otherwise the host it lives at; otherwise a generic label — never the
 * client_id, which is a random id that tells a user nothing.
 *
 * A name can be missing: dynamic client registration (RFC 7591, how MCP
 * clients like claude.ai register) makes `client_name` optional, and refusing
 * a nameless registration would lock those clients out. So the gap is filled
 * here, at display time, from what the client did register.
 */

export type ClientLike = {
  name?: string | null
  uri?: string | null
  redirectUris?: readonly string[] | null
}

export const UNNAMED_CLIENT = "An application"

/** The host of an http(s) URL, or null. */
export function hostOf(url: string | null | undefined): string | null {
  if (!url) return null
  try {
    const u = new URL(url)
    return u.protocol === "https:" || u.protocol === "http:" ? u.host : null
  } catch {
    return null
  }
}

/** The host a client lives at: its homepage, else its first redirect URI. */
export function clientHost(client: ClientLike): string | null {
  return hostOf(client.uri) ?? hostOf(client.redirectUris?.[0])
}

export function clientDisplayName(client: ClientLike): string {
  return client.name?.trim() || clientHost(client) || UNNAMED_CLIENT
}
