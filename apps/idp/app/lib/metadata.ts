import { z } from "zod"
import { RESOURCE_TYPE_RE } from "@willyim/idp/schemas"

/**
 * App metadata schema. The app's metadata (stored on oauth_client) holds its
 * product config: whether open signup is allowed, the catalog of product
 * permissions it declares (which the IdP grants to members and emits
 * downstream), and the resource types those permissions may be scoped to.
 */

const dedupe = (a: string[]) => [...new Set(a.map((s) => s.trim()).filter(Boolean))]

/**
 * A resource TYPE the app declares: a permission family over instances the app
 * holds. `kirby:thread` means "the permissions `kirby:thread:<id>` for every
 * conversation bender currently has" — the IdP stores the type and asks the
 * app's `list` URL for the instances whenever it needs them, so neither side
 * keeps a copy of the other's list.
 */
export const resourceTypeSchema = z.object({
  type: z.string().regex(RESOURCE_TYPE_RE),
  // Falls back to the type name; see `parseAppMetadata`.
  label: z.string().min(1).optional(),
  list: z.string().url(),
})
export type ResourceTypeDecl = { type: string; label: string; list: string }

const dedupeTypes = (types: z.infer<typeof resourceTypeSchema>[]): ResourceTypeDecl[] => {
  const seen = new Map<string, ResourceTypeDecl>()
  for (const t of types) {
    if (seen.has(t.type)) continue
    seen.set(t.type, { type: t.type, label: t.label?.trim() || t.type, list: t.list.trim() })
  }
  return [...seen.values()]
}

/** Editable app config — the part an admin sets via the metadata editor. */
export const appConfigSchema = z.object({
  allow_signup: z.boolean().default(false),
  // The app's declared product-permission catalog (unique, non-empty strings).
  permissions: z.array(z.string().min(1)).default([]).transform(dedupe),
  // The app's protected RESOURCES, as absolute URIs — e.g. its MCP server,
  // `https://bender.romo.fyi/mcp`. An OAuth client (say, Claude) that asks for
  // a token with `resource=<one of these>` (RFC 8707) gets a JWT whose `aud`
  // is that URI and whose permissions claim is the user's grants for THIS app
  // (claims.server.ts). That is what lets any app expose itself over MCP by
  // registering here and nothing else: the resource server just verifies the
  // JWT against our JWKS and reads the claim.
  resources: z.array(z.string().url()).default([]).transform(dedupe),
  // Resource TYPES (not to be confused with `resources` above): permission
  // families over instances the app holds. See resourceTypeSchema.
  resource_types: z.array(resourceTypeSchema).default([]).transform(dedupeTypes),
})
export type AppConfig = z.infer<typeof appConfigSchema>

/** Full stored app metadata: the immutable `app` key plus the editable config. */
export type AppMetadata = AppConfig & { app: string | null }

const EMPTY_CONFIG: AppConfig = {
  allow_signup: false,
  permissions: [],
  resources: [],
  resource_types: [],
}

/**
 * better-auth and drizzle's mode:"json" columns don't always agree on
 * serialization (values can come back already-parsed, once-, or twice-encoded),
 * so unwrap defensively up to two JSON layers.
 */
export function unwrapJson(value: unknown): unknown {
  let current = value
  for (let i = 0; i < 2 && typeof current === "string"; i++) {
    try {
      current = JSON.parse(current)
    } catch {
      break
    }
  }
  return current
}

/** Lenient read of whatever is stored in oauth_client.metadata. */
export function parseAppMetadata(raw: unknown): AppMetadata {
  const unwrapped = unwrapJson(raw)
  const obj = (unwrapped && typeof unwrapped === "object" ? (unwrapped as Record<string, unknown>) : {}) ?? {}
  const app = typeof obj.app === "string" ? obj.app : null
  const parsed = appConfigSchema.safeParse(obj)
  const config = parsed.success ? parsed.data : EMPTY_CONFIG
  return { app, ...config }
}

/**
 * The one shape ever written to oauth_client.metadata. Every writer goes
 * through this so a new field cannot be dropped by a path that forgot it.
 */
export function serializeAppMetadata(meta: AppMetadata) {
  return {
    app: meta.app,
    allow_signup: meta.allow_signup,
    permissions: meta.permissions,
    resources: meta.resources,
    resource_types: meta.resource_types,
  }
}
