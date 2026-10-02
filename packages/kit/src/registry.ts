import { bind, isMethod, type OnCall } from "./method.js"
import { META, type MethodMeta } from "./types.js"

export type Factory = ((ctx: any) => object) & { description?: string }

/** A built service with its public methods bound to `ctx`, checked or `internal`; plain members as is. */
export function bindService(
  built: object,
  ctx: unknown,
  service: string,
  onCall: OnCall | undefined,
  internal: boolean,
) {
  const methods: Record<string, unknown> = { ...built }
  for (const [name, m] of Object.entries(methods))
    if (isMethod(m)) methods[name] = bind(m, ctx, service, name, onCall, internal)
  return methods
}

const CHECKED: unique symbol = Symbol.for("kit.checked")

/** Marks `trusted` as the services factories close over, whose checked view is `checked`. */
export const linkViews = (trusted: object, checked: object) =>
  Object.defineProperty(trusted, CHECKED, { value: checked })

/** The checked view of a context's services: the edges run it whichever view they're handed. */
export const checkedServices = (services: object) =>
  ((services as { [CHECKED]?: object })[CHECKED] ?? services) as Record<
    string,
    Record<string, unknown>
  >

function buildEmpty(factory: Factory, service: string) {
  try {
    return bindService(factory({ services: {} }), { services: {} }, service, undefined, false)
  } catch (e) {
    throw new Error(
      `kit: service "${service}" failed to build against an empty context; use ctx only inside method bodies (${e instanceof Error ? e.message : String(e)})`,
      { cause: e },
    )
  }
}

export type RegistryEntry = MethodMeta & {
  /** `"service.method"`: the HTTP name. */
  name: string
  /** The tool name for MCP and agent runtimes: `contract.name`, or `service_method`. */
  tool: string
  /** The service's description. */
  description?: string
}

/** What MCP and the model APIs (Claude, OpenAI) all accept as a tool name. */
const TOOL_NAME = /^[A-Za-z0-9_-]{1,64}$/

const cache = new WeakMap<object, RegistryEntry[]>()

/**
 * Every public method in the app, for the adapters and discovery. Factories
 * run against an empty context here, so they must not use the context while
 * they build, only inside method bodies. Built once per app; throws on a tool
 * name that is invalid or taken twice.
 */
export function registry(app: { config: { services: Record<string, Factory> } }): RegistryEntry[] {
  const hit = cache.get(app.config.services)
  if (hit) return hit
  const entries = Object.entries(app.config.services).flatMap(([service, factory]) =>
    Object.values(buildEmpty(factory, service)).flatMap((m) => {
      if (!isMethod(m)) return []
      const meta = m[META]
      return [
        {
          ...meta,
          name: `${service}.${meta.method}`,
          tool: meta.contract.name ?? `${service}_${meta.method}`,
          description: factory.description,
        },
      ]
    }),
  )
  const seen = new Map<string, string>()
  for (const e of entries) {
    if (!TOOL_NAME.test(e.tool))
      throw new Error(
        `kit: ${e.name} has the tool name "${e.tool}"; use 1-64 letters, digits, "_" or "-"`,
      )
    const other = seen.get(e.tool)
    if (other) throw new Error(`kit: ${other} and ${e.name} share the tool name "${e.tool}"`)
    seen.set(e.tool, e.name)
  }
  cache.set(app.config.services, entries)
  return entries
}
