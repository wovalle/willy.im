import type { AuthService } from "./auth.server"

/**
 * RFC 8414 places the metadata document at the ROOT with the issuer's path
 * suffixed: our issuer is https://idp.willy.im/auth, so strict OAuth/MCP clients
 * fetch /.well-known/oauth-authorization-server/auth. Better Auth only serves it
 * under the basePath (/auth/.well-known/...), so we proxy root → basePath.
 */
export function proxyWellKnown(request: Request, auth: AuthService, basePathDoc: string) {
  const origin = new URL(request.url).origin
  const target = new URL(`/auth/.well-known/${basePathDoc}`, origin)
  return auth.handler(new Request(target, { method: "GET", headers: request.headers }))
}
