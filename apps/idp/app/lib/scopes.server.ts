import { RESOURCE_ID_RE } from "@willyim/idp/schemas"

import type { ResourceTypeDecl } from "./metadata"
import { ResourceListError, type ResourceLister } from "./resources.server"

/**
 * What a product-permission string means against one app's catalog.
 *
 * The catalog has two halves. Flat permissions name a surface and match
 * exactly — `kirby:read`. Resource types name a permission FAMILY over
 * instances the app holds — `kirby:thread` — and a grant under one is the
 * composed string `<type>:<id>`, `kirby:thread:t_7f3a`. The IdP stores the
 * grant string; it never stores the instances (see resources.server.ts).
 *
 * Nothing downstream changes shape: the composed string is what lands on a
 * key's scopes and in the permissions claim, and `grants()` already treats
 * `kirby:*` and `*` as covering it. That is the whole point of doing this
 * here instead of per app — every consumer keeps the check it already has.
 */

export type AppCatalog = {
  permissions: string[]
  resourceTypes: ResourceTypeDecl[]
}

export const EMPTY_CATALOG: AppCatalog = { permissions: [], resourceTypes: [] }

export type ScopeClass =
  | { kind: "permission"; scope: string }
  | { kind: "instance"; scope: string; type: ResourceTypeDecl; id: string }

/** `<type>:<id>` — the grant string for one instance. */
export function composeScope(type: string, id: string): string {
  return `${type}:${id}`
}

/**
 * Classify one scope. A flat catalog entry wins outright; otherwise the LONGEST
 * declared type that prefixes the scope claims it, and the remainder must be a
 * well-formed instance id (one segment: no colon, no `*`, no whitespace).
 * Returns null for anything the catalog does not declare.
 */
export function classifyScope(scope: string, catalog: AppCatalog): ScopeClass | null {
  if (catalog.permissions.includes(scope)) return { kind: "permission", scope }
  const candidates = catalog.resourceTypes
    .filter((t) => scope.startsWith(`${t.type}:`))
    .sort((a, b) => b.type.length - a.type.length)
  for (const type of candidates) {
    const id = scope.slice(type.type.length + 1)
    if (RESOURCE_ID_RE.test(id)) return { kind: "instance", scope, type, id }
  }
  return null
}

/** Does the catalog declare this scope — as a permission or as an instance of a type? */
export function isDeclared(scope: string, catalog: AppCatalog): boolean {
  return classifyScope(scope, catalog) !== null
}

/**
 * Everything an app admin holds. Flat permissions are enumerable, instances
 * are not (they live in the app), so a type resolves to its wildcard — which
 * `grants()` already expands. An admin is therefore never handed a list that
 * silently misses the conversation added five minutes ago.
 */
export function adminScopesFor(catalog: AppCatalog): string[] {
  return [
    ...new Set([...catalog.permissions, ...catalog.resourceTypes.map((t) => `${t.type}:*`)]),
  ]
}

export type ScopeResolution =
  | { ok: true; scopes: string[] }
  /** Neither a declared permission nor `<declared type>:<id>`. */
  | { error: "unknown_scopes"; detail: string[] }
  /** The type is declared, but the app does not currently list that instance. */
  | { error: "unknown_resource"; detail: string[] }
  /** The app's list endpoint could not be read; `detail` names the types. */
  | { error: "resource_lookup_failed"; detail: string[] }

/**
 * Validate a set of scopes for a grant. Structure is checked against the
 * catalog first (no network); instance ids are then confirmed against the
 * app's live list, one call per type. Trims and dedupes, preserving order.
 *
 * Rejects rather than drops: the caller asked for something specific, and a
 * grant that silently lost a scope is worse than one that failed loudly.
 */
export async function resolveScopes(
  scopes: string[],
  app: string,
  catalog: AppCatalog,
  resources: ResourceLister,
): Promise<ScopeResolution> {
  const wanted = [...new Set(scopes.map((s) => s.trim()).filter(Boolean))]
  const classified = wanted.map((s) => [s, classifyScope(s, catalog)] as const)
  const unknown = classified.filter(([, c]) => c === null).map(([s]) => s)
  if (unknown.length) return { error: "unknown_scopes", detail: unknown }

  const byType = new Map<string, { type: ResourceTypeDecl; ids: string[] }>()
  for (const [, c] of classified) {
    if (!c || c.kind !== "instance") continue
    const entry = byType.get(c.type.type) ?? { type: c.type, ids: [] }
    entry.ids.push(c.id)
    byType.set(c.type.type, entry)
  }

  const missing: string[] = []
  const failed: string[] = []
  for (const { type, ids } of byType.values()) {
    let listed: Set<string>
    try {
      listed = new Set((await resources({ app, type })).map((r) => r.id))
    } catch (err) {
      if (!(err instanceof ResourceListError)) throw err
      failed.push(type.type)
      continue
    }
    for (const id of ids) if (!listed.has(id)) missing.push(composeScope(type.type, id))
  }
  if (failed.length) return { error: "resource_lookup_failed", detail: failed }
  if (missing.length) return { error: "unknown_resource", detail: missing }
  return { ok: true, scopes: wanted }
}

/** One line for a human, when the console has to explain a refusal. */
export function describeScopeError(res: Exclude<ScopeResolution, { ok: true }>): string {
  switch (res.error) {
    case "unknown_scopes":
      return `Not in this app's catalog: ${res.detail.join(", ")}`
    case "unknown_resource":
      return `The app does not currently list: ${res.detail.join(", ")}`
    case "resource_lookup_failed":
      return `Could not read the app's resource list for: ${res.detail.join(", ")}`
  }
}
