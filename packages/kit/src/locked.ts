import type { KitApp } from "./app.js"

/**
 * What a caller with no credentials gets when `discovery.anonymous` is "none":
 * no method names at all, only why, and how to authenticate.
 */

export const locked = (app: KitApp, caller: { kind?: string }) =>
  caller.kind === "anonymous" && app.config.discovery?.anonymous === "none"

const NOTE =
  "Methods are listed only for authenticated callers. This request sent no credentials, so it sees none."

const auth = (app: KitApp) => app.config.discovery?.auth

/** 200 markdown: the app, why it's empty, and how to log in. */
export function lockedLlmsTxt(app: KitApp): string {
  const a = auth(app)
  const lines = [`# ${app.config.name ?? "API"}`, ""]
  if (app.config.description) lines.push(`> ${app.config.description}`, "")
  lines.push(NOTE, "")
  if (a?.instructions) lines.push(a.instructions, "")
  if (a?.keysUrl) lines.push(`Get an API key: ${a.keysUrl}`)
  if (a?.oauth) lines.push(`OAuth protected resource metadata: ${a.oauth.resourceMetadataUrl}`)
  return lines.join("\n").trimEnd() + "\n"
}

/** 200 OpenAPI 3.1 with no paths: the info, the note and the security schemes. */
export function lockedOpenapi(app: KitApp, origin: string) {
  const a = auth(app)
  const description = [
    app.config.description,
    NOTE,
    a?.instructions,
    a?.keysUrl && `Get an API key: ${a.keysUrl}`,
  ]
    .filter(Boolean)
    .join("\n\n")
  return {
    openapi: "3.1.0",
    info: { title: app.config.name ?? "API", version: "1", description },
    servers: [{ url: origin }],
    security: [{ bearer: [] }, ...(a?.oauth ? [{ oauth: [] }] : [])],
    paths: {},
    components: {
      securitySchemes: {
        bearer: {
          type: "http",
          scheme: "bearer",
          description: a?.instructions ?? "An API key sent as `Authorization: Bearer <key>`.",
        },
        ...(a?.oauth && {
          oauth: {
            type: "http",
            scheme: "bearer",
            description: `An OAuth access token. Protected resource metadata (RFC 9728): ${a.oauth.resourceMetadataUrl}`,
            "x-resource-metadata": a.oauth.resourceMetadataUrl,
          },
        }),
      },
    },
  }
}

/** The 401 for `/api/*`, before any method is looked up. */
export function unauthenticated(app: KitApp): Response {
  const a = auth(app)
  const metadata = a?.oauth?.resourceMetadataUrl.replace(/"/g, "")
  return Response.json(
    {
      error: "authentication required",
      ...(a?.instructions && { instructions: a.instructions }),
      ...(a?.keysUrl && { keysUrl: a.keysUrl }),
      ...(metadata && { resourceMetadataUrl: metadata }),
    },
    {
      status: 401,
      headers: {
        "www-authenticate": metadata ? `Bearer resource_metadata="${metadata}"` : "Bearer",
      },
    },
  )
}
