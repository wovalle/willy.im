import { methods, type MethodName, type Methods } from "@willyim/idp/schemas"

/**
 * A method's wire contract, from the table in `@willyim/idp/schemas` the SDK
 * calls with: its input and output, and where it exists. An app method
 * (`scope: "app"`) runs in one app's tenant, `/apps/<app>/api/<name>`; an
 * IdP-level one in the null tenant, `/api/<name>`. Neither shows up in the
 * other's discovery, tools or MCP.
 */
export function io<N extends MethodName>(name: N) {
  const def: Methods[N] = methods[name]
  return {
    input: def.input as Methods[N]["input"],
    output: def.output as Methods[N]["output"],
    when:
      def.scope === "app"
        ? (ctx: { tenantId: string | null }) => ctx.tenantId !== null
        : (ctx: { tenantId: string | null }) => ctx.tenantId === null,
  }
}
