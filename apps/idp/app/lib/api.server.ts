import type { z } from "zod"

/**
 * Parses and validates a JSON request body for the management API. Throws a JSON
 * error Response (400 for unparseable, 422 for schema violations) that the route
 * lets bubble up to the RR error boundary — callers get a structured body.
 */
export async function readJson<S extends z.ZodType>(
  request: Request,
  schema: S,
): Promise<z.infer<S>> {
  let raw: unknown
  try {
    raw = await request.json()
  } catch {
    throw Response.json({ error: "invalid_json" }, { status: 400 })
  }
  const parsed = schema.safeParse(raw)
  if (!parsed.success) {
    throw Response.json(
      { error: "validation_error", issues: parsed.error.issues },
      { status: 422 },
    )
  }
  return parsed.data
}

/** 405 for an unsupported method on a resource route. */
export function methodNotAllowed(allow: string[]): Response {
  return Response.json(
    { error: "method_not_allowed" },
    { status: 405, headers: { Allow: allow.join(", ") } },
  )
}
