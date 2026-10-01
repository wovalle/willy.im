import { bind, isMethod, type OnCall } from "./method.js"
import { META, type MethodMeta } from "./types.js"

export type Factory = ((ctx: any) => object) & { description?: string }

/** Runs a factory on a context and binds its public methods to it. */
export function buildService(factory: Factory, ctx: unknown, service: string, onCall?: OnCall) {
  const methods: Record<string, unknown> = { ...factory(ctx) }
  for (const [name, m] of Object.entries(methods))
    if (isMethod(m)) methods[name] = bind(m, ctx, service, name, onCall)
  return methods
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
    Object.values(buildService(factory, { services: {} }, service)).flatMap((m) => {
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
