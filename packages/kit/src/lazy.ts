import type { Factory } from "./registry.js"

const LAZY = Symbol.for("kit.lazy")

type LazyState = {
  load: () => Promise<Factory>
  loading?: Promise<Factory>
  resolved?: Factory
}

type Lazy = Factory & { [LAZY]: LazyState }

/**
 * A service whose module loads on first use: `lazyService(() => import("./bot.service").then((m) => m.botService))`.
 *
 * The factory's module stays out of the code an app evaluates at startup, so a
 * heavy service (and everything it imports) costs nothing until a method is
 * called. Typed as the factory it loads, so `ctx.services.bot` keeps its types.
 *
 * Until it has loaded, the service's members are reached through a stand-in
 * that loads it and then calls the real member, so every member is awaited:
 * methods already are; a plain member must be an async function (or be read
 * after `loadServices`). `registry`, `tools` and `toMcpServer` need every
 * lazy service loaded: `handle` awaits `loadServices` itself, other callers
 * await it first.
 */
export function lazyService<F extends Factory>(load: () => Promise<F>): F {
  const state: LazyState = { load }
  const lazy = ((ctx: unknown) => {
    if (!state.resolved)
      throw new Error("kit: a lazy service was built before it loaded; await loadServices(app) first")
    return state.resolved(ctx)
  }) as Lazy
  Object.defineProperty(lazy, "description", { get: () => state.resolved?.description })
  lazy[LAZY] = state
  return lazy as unknown as F
}

/** The lazy state of `factory`, or undefined for an ordinary factory. */
export function lazyOf(factory: Factory): LazyState | undefined {
  return (factory as Partial<Lazy>)[LAZY]
}

/** Load a lazy factory once; every caller shares the same import. */
export function resolveLazy(state: LazyState): Promise<Factory> {
  if (state.resolved) return Promise.resolve(state.resolved)
  state.loading ??= state.load().then(
    (factory) => (state.resolved = factory),
    (error) => {
      state.loading = undefined // a failed import can be retried
      throw error
    },
  )
  return state.loading
}

/** Load every lazy service of `app`, so `registry`, `tools` and `toMcpServer` can run. */
export async function loadServices(app: { config: { services: Record<string, Factory> } }) {
  await Promise.all(
    Object.values(app.config.services).flatMap((factory) => {
      const state = lazyOf(factory)
      return state && !state.resolved ? [resolveLazy(state)] : []
    }),
  )
}
