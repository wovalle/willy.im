import type { Context, Permission } from "@willyim/kit"
import { redirect } from "react-router"

import type { AppContext } from "../context"
import { app, depsOf } from "../kit.server"
import { principalFrom } from "./caller.server"

/**
 * A method's refusal as a console form shows it: `{ error, field }`. kit's
 * invalid input (400) reads as its first field error; a denial (403) and
 * `fail()`'s 404/409/422/502 as their message. A 401, or anything that isn't a
 * `Response`, is thrown: editing the form can't fix it.
 */
export async function attempt<T>(
  fn: () => Promise<T>,
  field?: string,
): Promise<T | { error: string; field?: string }> {
  try {
    return await fn()
  } catch (e) {
    if (!(e instanceof Response) || ![400, 403, 404, 409, 422, 502].includes(e.status)) throw e
    const text = await e.text()
    let body: { error?: string; fields?: Record<string, string[] | undefined> } = {}
    try {
      body = JSON.parse(text)
    } catch {}
    const [name, errors] = Object.entries(body.fields ?? {})[0] ?? []
    const error = errors?.[0] ? `${name === "_" ? "" : `${name}: `}${errors[0]}` : body.error
    return { error: error ?? (text || "Something went wrong."), ...(field ? { field } : {}) }
  }
}

/** Did `attempt` come back with a refusal? */
export const refused = (value: unknown): value is { error: string; field?: string } =>
  typeof value === "object" && value !== null && "error" in value && typeof value.error === "string"

/**
 * The console's door: the signed-in human's kit context in `tenant` (an app
 * key, or null for the IdP level). Nobody signed in goes to /login; someone
 * who holds nothing there, or lacks `need` (`"*"`: a superadmin), goes to
 * /account — a bounce beats a dead end for someone who simply isn't an admin.
 * What they may do once in is each method's own permission.
 */
export async function consoleContext(
  c: AppContext,
  request: Request,
  tenant: string | null,
  need?: Permission | "*",
): Promise<Context> {
  const principal = await principalFrom(request, c, c.services.auth)
  const ctx = principal
    ? await app.context(principal, tenant, depsOf(c, request)).catch((e) => {
        if (e instanceof Response && e.status === 404) return null
        throw e
      })
    : null
  const allowed =
    !!ctx && (!need || (need === "*" ? ctx.caller.isSuperadmin : ctx.caller.has(need)))
  c.logger.info("console.gate", { principal: principal?.id, tenant, need, allowed })
  if (!principal) throw redirect("/login")
  if (!ctx || !allowed) throw redirect("/account")
  return ctx
}
