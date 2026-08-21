/**
 * The OIDC wire, as zod schemas: discovery, the token endpoint, and the claim
 * set. These are not in `./schemas` with the management API because they are
 * standards-defined — nothing generates them, and they never appear in our
 * OpenAPI document.
 *
 * Two different postures live here on purpose:
 *
 *  - **Strict** on anything we act on. Without `token_endpoint` there is no
 *    flow to run, and an `access_token` that is absent must not become `""`
 *    and get written to a session row.
 *  - **Tolerant** on claims. A user with no permissions, no workspaces, or no
 *    display name is ordinary, not an error — those degrade to empty. Only
 *    `sub` is genuinely required, since it is the identity.
 *
 * Unknown fields pass through everywhere: an IdP is allowed to grow.
 */

import { z } from "zod"

export const PERMISSIONS_CLAIM = "https://willy.im/permissions"
export const WORKSPACES_CLAIM = "https://willy.im/workspaces"

/** The subset of the discovery document we use, plus the fields we may. */
export const DiscoverySchema = z.looseObject({
  issuer: z.string(),
  authorization_endpoint: z.string().url(),
  token_endpoint: z.string().url(),
  userinfo_endpoint: z.string().url(),
  end_session_endpoint: z.string().url().optional(),
  jwks_uri: z.string().url().optional(),
  /**
   * Per-app session ceiling, in seconds. Not standard OIDC — an IdP extension
   * the SDK clamps `session.expiresIn` against when present.
   */
  session_max_age: z.number().optional(),
})

export type Discovery = z.output<typeof DiscoverySchema>

/** Token-endpoint output, camelCased so app code never sees the wire shape. */
export const TokensSchema = z
  .looseObject({
    access_token: z.string().min(1),
    token_type: z.string().default("Bearer"),
    expires_in: z.number().nullish(),
    refresh_token: z.string().nullish(),
    id_token: z.string().nullish(),
    scope: z.string().nullish(),
  })
  .transform((raw) => ({
    accessToken: raw.access_token,
    tokenType: raw.token_type,
    /** Seconds until the access token expires, when the IdP says. */
    expiresIn: raw.expires_in ?? null,
    refreshToken: raw.refresh_token ?? null,
    idToken: raw.id_token ?? null,
    scope: raw.scope ?? null,
  }))

export type Tokens = z.output<typeof TokensSchema>

/** A tenant inside THIS app. `domain` is set for multi-domain apps, else null. */
export const WorkspaceSchema = z.looseObject({
  id: z.string(),
  slug: z.string().default(""),
  name: z.string().default(""),
  domain: z.string().nullish().transform((value) => value || null),
  role: z.string().default("member"),
})

export type Workspace = z.output<typeof WorkspaceSchema>

/**
 * The RFC 8693 `act` claim: present while an IdP admin is impersonating the
 * user. Audit-only — tag your logs with it, never branch authorization on it.
 */
export const ActorSchema = z.looseObject({
  sub: z.string().min(1),
  email: z.string().optional(),
})

export type Actor = z.output<typeof ActorSchema>

/** `.catch` per field, so one bad element degrades instead of failing a login. */
const tolerantArray = <T extends z.ZodType>(item: T) =>
  z.array(item.nullable().catch(null)).catch([]).transform((values) => values.filter((v) => v !== null))

/**
 * Wire claims -> `Claims`. The `https://willy.im/*` namespace is unwrapped
 * here: namespaced URI claims are an OIDC requirement, not something app code
 * should ever have to type.
 */
export const ClaimsSchema = z
  .looseObject({
    sub: z.string().min(1),
    email: z.string().catch(""),
    email_verified: z.boolean().catch(false),
    name: z.string().nullish().catch(null),
    picture: z.string().nullish().catch(null),
    image: z.string().nullish().catch(null),
    [PERMISSIONS_CLAIM]: tolerantArray(z.string()),
    [WORKSPACES_CLAIM]: tolerantArray(WorkspaceSchema),
    act: ActorSchema.nullish().catch(null),
  })
  .transform((raw) => ({
    sub: raw.sub,
    email: raw.email,
    emailVerified: raw.email_verified,
    name: raw.name || null,
    image: raw.picture || raw.image || null,
    /** Product permissions granted in this app. Unwrapped from the namespace. */
    permissions: raw[PERMISSIONS_CLAIM],
    /** Workspaces the user belongs to in this app. Unwrapped from the namespace. */
    workspaces: raw[WORKSPACES_CLAIM],
    actor: raw.act ?? null,
  }))

export type Claims = z.output<typeof ClaimsSchema>
