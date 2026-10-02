import { bind, isMethod, type OnCall } from "./method.js"
import { META, type MethodMeta } from "./types.js"

export type Factory = ((ctx: any) => object) & { description?: string }

type View = {
  source: Record<PropertyKey, unknown>
  ctx: unknown
  service: string
  onCall: OnCall | undefined
  internal: boolean
}

const views = new WeakMap<object, View>()

/** The object a lazy member was read through: the view itself, or something that inherits from it. */
function viewOf(target: object) {
  for (let o: object | null = target; o; o = Object.getPrototypeOf(o)) {
    const view = views.get(o)
    if (view) return { view: o, state: view }
  }
  throw new Error("kit: a bound method was read outside its service")
}

const setMember = (view: object, name: PropertyKey, value: unknown) =>
  Object.defineProperty(view, name, { value, enumerable: true, configurable: true, writable: true })

// One accessor pair per method name, shared by every view: a context binds no closure up front.
const accessors = new Map<string, PropertyDescriptor>()
function lazyMember(name: string): PropertyDescriptor {
  let accessor = accessors.get(name)
  if (!accessor) {
    accessor = {
      enumerable: true,
      configurable: true,
      get(this: object) {
        const { view, state } = viewOf(this)
        const { source, ctx, service, onCall, internal } = state
        const bound = bind(source[name] as never, ctx, service, name, onCall, internal)
        setMember(view, name, bound)
        return bound
      },
      set(this: object, value: unknown) {
        setMember(viewOf(this).view, name, value)
      },
    }
    accessors.set(name, accessor)
  }
  return accessor
}

/**
 * A built service with its public methods bound to `ctx`, checked or `internal`;
 * plain members as is. Each method is bound the first time it's read, and kept.
 */
export function bindService(
  built: object,
  ctx: unknown,
  service: string,
  onCall: OnCall | undefined,
  internal: boolean,
) {
  const source: Record<PropertyKey, unknown> = { ...built }
  const methods: Record<PropertyKey, unknown> = {}
  views.set(methods, { source, ctx, service, onCall, internal })
  for (const key of Reflect.ownKeys(source)) {
    const value = source[key]
    if (typeof key === "string" && isMethod(value))
      Object.defineProperty(methods, key, lazyMember(key))
    else setMember(methods, key, value)
  }
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

function buildEmpty(factory: Factory, service: string): Record<string, unknown> {
  try {
    return { ...factory({ services: {} }) }
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
    Object.entries(buildEmpty(factory, service)).flatMap(([method, m]) => {
      if (!isMethod(m)) return []
      const { contract } = m[META]
      return [
        {
          contract,
          service,
          method,
          name: `${service}.${method}`,
          tool: contract.name ?? `${service}_${method}`,
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
