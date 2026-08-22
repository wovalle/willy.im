/**
 * @willyim/idp — login for apps that don't own identity.
 *
 * The IdP is the single source of truth for who someone is and what they may
 * do. The app runs no auth framework: it owns one session table, which is a
 * handle to IdP truth rather than a record of it.
 *
 * Zero runtime dependencies. `fetch` + WebCrypto + `Request`/`Response`, so the
 * same build runs on Cloudflare Workers, Node ≥20 and Bun.
 *
 *   @willyim/idp               this module — client + session
 *   @willyim/idp/drizzle       the session store, and the `idp_session` table
 *   @willyim/idp/react-router  the auth route and the loader guards
 */

export {
  createIdpClient,
  createPkce,
  DEFAULT_SCOPES,
  IdpError,
  SUPPORTED_SCOPES,
  type AuthorizationUrlInput,
  type Discovery,
  type IdpClient,
  type IdpClientOptions,
  type IdpScope,
  type Tokens,
} from "./client.js"

export {
  createIdp,
  DEFAULT_SESSION_COOKIE,
  safeNext,
  type Idp,
  type IdpOptions,
  type Session,
  type SessionOptions,
} from "./session.js"

export {
  memorySessions,
  type MemorySessionStore,
  type SessionRecord,
  type SessionStore,
} from "./store.js"

export {
  grants,
  normalizeClaims,
  PERMISSIONS_CLAIM,
  WORKSPACES_CLAIM,
  type Actor,
  type Claims,
  type Workspace,
} from "./claims.js"

export {
  createManagementApi,
  type ManagementApi,
  type ManagementApiOptions,
} from "./api.js"

export {
  createUserKeys,
  readApiKey,
  type AuthenticatedKey,
  type AuthenticateOptions,
  type AuthenticateResult,
  type CreateUserApiKeyInput,
  type ListFilter,
  type MintedUserApiKey,
  type UserApiKey,
  type UserKeyCacheOptions,
  type UserKeys,
  type UserKeysOptions,
  type UserKeyValidation,
} from "./user-keys.js"

export {
  createIdentities,
  type Identities,
  type IdentitiesOptions,
  type IdentityCacheOptions,
  type ResolvedIdentity,
  type IdentityResolution,
} from "./identities.js"

export { parseDuration, type Duration } from "./duration.js"
export {
  clearCookie,
  parseCookies,
  readCookie,
  serializeCookie,
  type CookieOptions,
} from "./cookie.js"
