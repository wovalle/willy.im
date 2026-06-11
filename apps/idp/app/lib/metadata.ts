import { z } from "zod"

/**
 * App + user metadata schemas. The app's metadata (stored on oauth_client) holds
 * its product config: whether open signup is allowed and the catalog of product
 * permissions it declares (which the IdP grants to members and emits downstream).
 * User metadata is per-app free-form JSON the app cares about.
 */

const dedupe = (a: string[]) => [...new Set(a.map((s) => s.trim()).filter(Boolean))]

/** Editable app config — the part an admin sets via the metadata editor. */
export const appConfigSchema = z.object({
  allow_signup: z.boolean().default(false),
  // The app's declared product-permission catalog (unique, non-empty strings).
  permissions: z.array(z.string().min(1)).default([]).transform(dedupe),
})
export type AppConfig = z.infer<typeof appConfigSchema>

/** Full stored app metadata: the immutable `app` key plus the editable config. */
export type AppMetadata = AppConfig & { app: string | null }

/** Lenient read of whatever is stored in oauth_client.metadata. */
export function parseAppMetadata(raw: unknown): AppMetadata {
  const obj = (raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {}) ?? {}
  const app = typeof obj.app === "string" ? obj.app : null
  const parsed = appConfigSchema.safeParse(obj)
  const config = parsed.success ? parsed.data : { allow_signup: false, permissions: [] }
  return { app, ...config }
}

/** Free-form per-app user metadata — any JSON object. */
export const userMetadataSchema = z.record(z.string(), z.unknown())

/** Parse + validate a JSON string the user typed into a metadata editor. */
export function parseJsonObject(
  raw: string,
): { ok: true; value: Record<string, unknown> } | { ok: false; error: string } {
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    return { ok: false, error: "Not valid JSON." }
  }
  const parsed = userMetadataSchema.safeParse(value)
  if (!parsed.success) return { ok: false, error: "Metadata must be a JSON object." }
  return { ok: true, value: parsed.data }
}
