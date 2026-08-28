// Notes live in bender's artifact store, not in D1. A note here is a markdown
// or HTML artifact there: bender owns the bytes, the version history (every
// save is a new version via `supersedes`), and the public rendered URL. This
// client wraps bender's authenticated /api/artifacts surface; the credential
// is a `wak_` IdP key holding `artifacts:read` + `artifacts:write`.

import { getAppEnv } from "./env"

export interface BenderArtifact {
  id: string
  filename: string
  contentType: string
  bytes: number
  title: string | null
  createdAt: number
  version: number
  /** Public rendered URL — anyone with the link, no login. */
  url: string | null
}

export interface BenderArtifactDetail extends BenderArtifact {
  updatedAt: number | null
  /** The current version's content, decoded to utf8. */
  content: string
}

export interface PublishInput {
  filename: string
  content: string
  contentType?: string
  title?: string
  /** Revise this artifact id in place (same link, new version). */
  supersedes?: string
}

async function request(path: string, init?: RequestInit): Promise<Response> {
  const env = getAppEnv()
  if (!env.BENDER_API_KEY) throw new Error("BENDER_API_KEY is not configured")
  // No trailing slash on the collection: bender's router is strict about
  // /api/artifacts vs /api/artifacts/.
  const res = await fetch(`${env.BENDER_API_URL}/api/artifacts${path}`, {
    ...init,
    headers: {
      "x-api-key": env.BENDER_API_KEY,
      ...(init?.body ? { "content-type": "application/json" } : {}),
      ...init?.headers,
    },
  })
  if (!res.ok && res.status !== 404) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null
    throw new Error(body?.error ?? `bender answered ${res.status} on ${path}`)
  }
  return res
}

export const benderArtifacts = {
  async list(limit = 100): Promise<BenderArtifact[]> {
    const res = await request(`?limit=${limit}`)
    const body = (await res.json()) as { artifacts: BenderArtifact[] }
    return body.artifacts
  },

  async get(id: string): Promise<BenderArtifactDetail | null> {
    const res = await request(`/${encodeURIComponent(id)}`)
    if (res.status === 404) return null
    const body = (await res.json()) as {
      id: string
      filename: string
      content_type: string
      bytes: number
      title: string | null
      version: number
      created_at: number
      updated_at: number | null
      content: string
    }
    return {
      id: body.id,
      filename: body.filename,
      contentType: body.content_type,
      bytes: body.bytes,
      title: body.title,
      createdAt: body.created_at,
      updatedAt: body.updated_at,
      version: body.version,
      url: this.publicUrl(body.id, body.filename),
      content: Buffer.from(body.content, "base64").toString("utf8"),
    }
  },

  async publish(input: PublishInput): Promise<BenderArtifact> {
    const res = await request("", {
      method: "POST",
      body: JSON.stringify({
        filename: input.filename,
        content: input.content,
        encoding: "utf8",
        content_type: input.contentType,
        title: input.title,
        supersedes: input.supersedes,
      }),
    })
    return (await res.json()) as BenderArtifact
  },

  async remove(id: string): Promise<boolean> {
    const res = await request(`/${encodeURIComponent(id)}`, { method: "DELETE" })
    return res.status !== 404
  },

  /** The public rendered URL for an artifact id + filename. */
  publicUrl(id: string, filename: string): string {
    return `https://artifacts.mellen.do/a/${id}/${encodeURIComponent(filename)}`
  },
}
