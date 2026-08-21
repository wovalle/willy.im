/**
 * The one table a consumer app owns. It is a *handle* to IdP truth, not a copy
 * of it: the claim columns are a TTL-cached projection refreshed from
 * `/userinfo`, and deleting a row logs that browser out on its next request.
 *
 * The store is an interface so the package isn't married to drizzle —
 * `memorySessions()` is the whole contract in thirty lines, and the tests run
 * against it.
 */

import type { Actor, Workspace } from "./claims.js"

export type SessionRecord = {
  /** Opaque, random. The cookie carries this id plus an HMAC over it. */
  id: string
  sub: string
  email: string
  name: string | null
  image: string | null
  permissions: string[]
  workspaces: Workspace[]
  actor: Actor | null
  accessToken: string
  refreshToken: string | null
  idToken: string | null
  accessTokenExpiresAt: Date | null
  /** Last successful `/userinfo` read — the freshness window is measured from here. */
  syncedAt: Date
  expiresAt: Date
  createdAt: Date
}

export type SessionStore = {
  get(id: string): Promise<SessionRecord | null>
  create(record: SessionRecord): Promise<SessionRecord>
  update(id: string, patch: Partial<SessionRecord>): Promise<SessionRecord | null>
  delete(id: string): Promise<void>
  /** Log out everywhere: every session this subject holds in this app. */
  deleteBySub(sub: string): Promise<void>
}

export type MemorySessionStore = SessionStore & {
  /** Every live record. Tests assert on this; nothing else should. */
  all(): SessionRecord[]
}

/** In-memory store for tests and single-process development. Nothing survives a restart. */
export function memorySessions(): MemorySessionStore {
  const rows = new Map<string, SessionRecord>()
  return {
    async get(id) {
      return rows.get(id) ?? null
    },
    async create(record) {
      rows.set(record.id, { ...record })
      return { ...record }
    },
    async update(id, patch) {
      const row = rows.get(id)
      if (!row) return null
      const next = { ...row, ...patch, id }
      rows.set(id, next)
      return { ...next }
    },
    async delete(id) {
      rows.delete(id)
    },
    async deleteBySub(sub) {
      for (const [id, row] of rows) if (row.sub === sub) rows.delete(id)
    },
    all() {
      return [...rows.values()]
    },
  }
}
