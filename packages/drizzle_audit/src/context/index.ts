import { AsyncLocalStorage } from "node:async_hooks"

import { setAuditContext } from "../postgres/runtime.js"
import type {
  AuditSqlExecutor,
  AuditTransactionCapable,
} from "../postgres/types.js"

// ─────────────────────────────────────────────────────────────────────────────
// Ambient audit context (opt-in).
//
// The explicit `withAuditedTransaction(db, actorId, cb)` from the main entry is
// the cross-runtime floor: it works everywhere and takes the actor by hand. This
// module adds an *ambient* layer on top of it, built on `AsyncLocalStorage`:
//
//   - establish "who is acting" ONCE at an entry boundary (a request, a job, an
//     engine tick) with `runWithAuditContext`, then
//   - open-or-reuse a single audited transaction anywhere below with
//     `ensureAuditedTx` — the actor is read from the ambient store, never
//     threaded through call signatures.
//
// Runtime support: this uses ONLY `AsyncLocalStorage` from `node:async_hooks`
// (not `createHook`/`executionAsyncId`/…), which is the subset Cloudflare
// Workers implements. It works on Node, Bun, and Workers (Workers needs the
// `nodejs_compat` flag + a recent compatibility date). If a target lacks ALS,
// fall back to the explicit `withAuditedTransaction` path.
// ─────────────────────────────────────────────────────────────────────────────

if (typeof AsyncLocalStorage === "undefined") {
  throw new Error(
    "@willyim/drizzle-audit/context requires AsyncLocalStorage from node:async_hooks. " +
      "On Cloudflare Workers enable the `nodejs_compat` flag (with a recent compatibility " +
      "date). On other runtimes use the explicit withAuditedTransaction(db, actorId, cb) " +
      "from @willyim/drizzle-audit/postgres instead.",
  )
}

/** Opaque to the library: an actor string + the GUC map written for the tx. */
export type AuditContext = {
  /** Value written to the actor GUC (default `app.user_id`). */
  actorId: string
  /** Extra session GUCs (full GUC name → value), e.g. `app.workspace_id`. */
  context?: Record<string, string>
}

/**
 * How the ambient actor is resolved. Pass a plain `AuditContext` to resolve it
 * eagerly, or a thunk to resolve it LAZILY — the thunk runs only when the first
 * audited write actually happens, so read-only units of work never pay for it
 * (e.g. resolving a session on a request that only reads).
 */
export type AuditContextInput =
  | AuditContext
  | (() => AuditContext | Promise<AuditContext>)

type Cell = {
  resolve: () => AuditContext | Promise<AuditContext>
  /** Memoised result of `resolve` once it has run. */
  resolved: AuditContext | null
  /** The currently-open audited tx, tracked for reentrancy. */
  tx: AuditSqlExecutor | null
}

const als = new AsyncLocalStorage<Cell>()

/**
 * Establish the ambient audit actor for the duration of `fn`. No transaction is
 * opened here — `ensureAuditedTx` opens one lazily on the first write below.
 */
export function runWithAuditContext<T>(
  audit: AuditContextInput,
  fn: () => T,
): T {
  const resolve = typeof audit === "function" ? audit : () => audit
  const resolved = typeof audit === "function" ? null : audit
  return als.run({ resolve, resolved, tx: null }, fn)
}

/** The ambient audit context if one is set AND already resolved, else null. */
export function maybeCurrentAudit(): AuditContext | null {
  return als.getStore()?.resolved ?? null
}

/**
 * The ambient audit context. Throws if no context is set, or if it is set but
 * not yet resolved (a lazy resolver that has not run). It is always resolved
 * inside an `ensureAuditedTx` callback, which is the intended place to read it
 * (e.g. to stamp a domain "createdBy" column from the actor).
 */
export function currentAudit(): AuditContext {
  const cell = als.getStore()
  if (!cell) {
    throw new Error(
      "no ambient audit context — wrap the unit of work in runWithAuditContext(...)",
    )
  }
  if (!cell.resolved) {
    throw new Error(
      "ambient audit context not resolved yet — read currentAudit() inside an " +
        "ensureAuditedTx callback, or pass an eager AuditContext to runWithAuditContext",
    )
  }
  return cell.resolved
}

/** True if an ambient audit context is in scope (resolved or not). */
export function hasAuditContext(): boolean {
  return als.getStore() !== undefined
}

/**
 * THE primitive: ensure this unit of work runs inside ONE audited transaction,
 * reusing an already-open one if present (reentrant). The actor is read from the
 * ambient context (resolving it on first use). Reads should never call this, so
 * they never open a transaction.
 *
 * Throws if called with no ambient audit context — the guardrail that turns a
 * missed boundary into a loud failure instead of an unattributed write.
 */
export async function ensureAuditedTx<
  TTransaction extends AuditSqlExecutor,
  TResult,
>(
  db: AuditTransactionCapable<TTransaction>,
  run: (tx: TTransaction) => Promise<TResult> | TResult,
  contextKey = "app.user_id",
): Promise<TResult> {
  const cell = als.getStore()
  if (!cell) {
    throw new Error(
      "audited write outside an audit context — wrap the unit of work in " +
        "runWithAuditContext(...) (or use the explicit withAuditedTransaction)",
    )
  }

  // Reentrant: a tx is already open in this context — reuse it.
  if (cell.tx) return run(cell.tx as TTransaction)

  const audit = cell.resolved ?? (cell.resolved = await cell.resolve())

  return db.transaction(async (tx) => {
    await setAuditContext(tx, audit.actorId, contextKey, {
      context: audit.context,
    })
    cell.tx = tx
    try {
      return await run(tx)
    } finally {
      cell.tx = null
    }
  })
}
