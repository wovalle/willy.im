/**
 * Luchy analytics — server side.
 *
 * The browser script (see `root.tsx`) auto-tracks pageviews, outbound links
 * and `data-luchy-event` clicks. What it cannot see is what the IdP actually
 * *did*: every console mutation is a form POST whose `intent` field names it
 * (`rotate`, `invite-member`, `create-api-key`, …), every management-API
 * mutation is a method-discriminated JSON request, and every auth verb is a
 * POST under `/auth/` whose path already names the operation.
 *
 * So instead of sprinkling track calls across route modules, the Worker
 * derives the event from the request it already has: normalized route +
 * intent (or method when there is no intent). One hook in `workers/app.ts`,
 * zero per-call-site code, and a new intent is tracked the day it is written.
 *
 * Ported from kasso's `lib/luchy.ts` (PR #258 there), with two deviations:
 * `/auth/` is tracked rather than ignored (auth *is* this product), and
 * intent-less mutations carry the lowercased method so PATCH and DELETE on
 * the same API route report under different names.
 */

/** Public ingest key — it ships in the HTML for the browser script too. */
export const LUCHY_API_KEY = "f7060145b46b4668a609b2c6b79c04a3"
export const LUCHY_ENDPOINT = "https://dash.luchy.app/api/ingest"
export const LUCHY_SCRIPT_SRC = "https://cdn.luchy.app/luchy.min.js"

/** Methods that change something. GET/HEAD are pageviews — the client's job. */
const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"])

/** Machine traffic with no product signal. */
const IGNORED_PREFIXES = ["/__manifest"]

/**
 * Consumer apps validate end-user API keys on (potentially) every request
 * they serve. That is key plumbing, not product usage — it already bumps
 * `lastUsedAt` on the key row, and here it would drown everything else.
 * Matched on the normalized route (app keys stay literal, so a set of full
 * names can't cover every app).
 */
const IGNORED_ROUTE_SUFFIXES = ["/user-keys/validate"]

/**
 * `intent` arrives from a form body, so it is client-controlled. Only a plain
 * identifier becomes part of an event name — anything else is treated as
 * absent, so a crafted body can't mint junk event names.
 */
const INTENT_PATTERN = /^[A-Za-z0-9_-]{1,40}$/

export function isMutatingMethod(method: string): boolean {
  return MUTATING_METHODS.has(method.toUpperCase())
}

/** A path segment that is an id (uuid, number, or opaque token) → `:id`. */
function isIdSegment(segment: string): boolean {
  if (segment.length === 0) return false
  if (/^\d+$/.test(segment)) return true
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(segment)) return true
  // Better-auth ids and `wim_` keys: long and mixed. Keeps human route names
  // (`applications`, `account`) and short app keys (`luchy`) intact while
  // collapsing opaque ids.
  return segment.length >= 16 && /\d/.test(segment)
}

/**
 * `/users/aBc123.../identities` → `users/:id/identities`.
 *
 * Client-side submissions land on React Router's single-fetch URL
 * (`/users/abc.data`), so the `.data` suffix is stripped — otherwise the same
 * action would report under two names depending on whether the page was
 * hydrated.
 */
export function normalizeRoute(pathname: string): string {
  const segments = pathname
    .replace(/\.data$/, "")
    .split("/")
    .filter(Boolean)
  if (segments.length === 0) return "home"
  if (segments.length === 1 && segments[0] === "_root") return "home"
  return segments.map((s) => (isIdSegment(s) ? ":id" : s)).join("/")
}

/**
 * The event name for a mutation, or `null` when the request is not worth an
 * event (read, machine traffic).
 *
 * Named `route:intent` — an intent alone is ambiguous (`delete` and `update`
 * appear on several routes), the pair is not. Without an intent the suffix is
 * the lowercased method, so `api/v1/applications:post` and
 * `api/v1/applications/:id:delete` stay distinct.
 */
export function serverEventName(request: {
  method: string
  pathname: string
  status: number
  intent?: string | null
}): string | null {
  const method = request.method.toUpperCase()
  if (!MUTATING_METHODS.has(method)) return null
  if (IGNORED_PREFIXES.some((p) => request.pathname.startsWith(p))) return null
  const route = normalizeRoute(request.pathname)
  if (IGNORED_ROUTE_SUFFIXES.some((s) => route.endsWith(s))) return null
  const intent =
    request.intent && INTENT_PATTERN.test(request.intent) ? request.intent : null
  return intent ? `${route}:${intent}` : `${route}:${method.toLowerCase()}`
}

/** Only urlencoded bodies are parsed for `intent`; a multipart upload could be
 * megabytes and no route reads an intent out of one. */
export function carriesIntent(contentType: string | null): boolean {
  return (contentType ?? "").includes("application/x-www-form-urlencoded")
}

/**
 * Fire-and-forget POST to `POST /api/ingest/event`. Never throws, never blocks.
 *
 * The field is `payload`, NOT `props`: the ingest endpoint validates with a
 * non-passthrough zod object, so a `props` key is silently stripped and the
 * event lands with no properties at all.
 */
export async function trackServerEvent(event: {
  name: string
  pathname: string
  userAgent?: string
  payload?: Record<string, string | number | boolean>
}): Promise<void> {
  try {
    await fetch(`${LUCHY_ENDPOINT}/event`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${LUCHY_API_KEY}`,
      },
      body: JSON.stringify({
        name: event.name,
        type: "server",
        pathname: event.pathname,
        payload: event.payload,
        userAgent: event.userAgent,
      }),
    })
  } catch {
    // Analytics must never affect a request.
  }
}
