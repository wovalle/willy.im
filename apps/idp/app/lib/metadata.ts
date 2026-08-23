import { z } from "zod"

/**
 * App metadata schema. The app's metadata (stored on oauth_client) holds its
 * product config: whether open signup is allowed and the catalog of product
 * permissions it declares (which the IdP grants to members and emits
 * downstream).
 */

const dedupe = (a: string[]) => [...new Set(a.map((s) => s.trim()).filter(Boolean))]

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
})
export type AppConfig = z.infer<typeof appConfigSchema>

/** Full stored app metadata: the immutable `app` key plus the editable config. */
export type AppMetadata = AppConfig & { app: string | null }

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
  const config = parsed.success ? parsed.data : { allow_signup: false, permissions: [], resources: [] }
  return { app, ...config }
}
