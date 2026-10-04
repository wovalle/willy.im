# @willyim/idp

## 2.0.0

### Major Changes

- bb4c6f4: The IdP no longer serves `/api/v1`, and the SDK drops what spoke it: `createManagementApi(...).request(method, "/api/v1/…")`, the `@willyim/idp/schemas/openapi` entry point (`buildOpenApiDocument`) and the `openapi/idp-api.json` snapshot are gone. `call("<service>.<method>", input, { app })` reaches every method; the IdP serves each caller's OpenAPI document at `/openapi.json` (`/apps/<app>/openapi.json` inside an app), with `/llms.txt` beside it.

## 1.0.0

### Major Changes

- 1c322f5: The management API moves onto the IdP's semantic methods (served by `@willyim/kit`). `createUserKeys`, `createAppTokens` and `createIdentities` keep their signatures; underneath they now call `POST /apps/<app>/api/user_keys.validate` (`.list`, `.mint`, `.revoke`), `app_tokens.mint` and `identities.resolve` instead of `/api/v1`, so they need an IdP that serves those (this release's).

  New: `createManagementApi(...).call("members.invite", input, { app })` reaches every method, typed from the `methods` table in `@willyim/idp/schemas` (name → scope, input, output), which the IdP's method contracts are written from. Errors are the IdP's as they arrive, in an `IdpError`: 400 `{ error, fields }` for invalid input (it was 422 `validation_error`), `{ error }` with a message otherwise; refused scopes stay 422 and an unreadable resource list 502.

  `MemberSchema` gains `productPermissions` (default `[]`); `InviteMemberInput.email` is trimmed.

  `request(method, "/api/v1/…")` still works against the IdP's `/api/v1`, which is kept until every app is on this major.

## 0.8.0

### Minor Changes

- 01d9a27: App tokens, GitHub-App style: an IdP admin key never goes to an app. `POST /api/v1/apps/{app}/tokens` exchanges it for a short-lived (at most 1h) `wat_` token bound to that app, carrying `["*"]` unless narrowed to `scopes` or one `workspaceId`. `createAppTokens({ baseUrl, token })` mints them: `get(app, { scopes?, workspaceId? })` reuses a token until a minute before it expires, and concurrent callers share one mint. Apps validate app tokens through the existing user-key validation: `UserApiKeyValidationSchema` hits now carry `kind` (`"user"`, or `"app"` with `issuedBy`), and `createUserKeys().authenticate` checks required scopes wildcard-aware (`*`, `ns:*`). New in `@willyim/idp/schemas`: `CreateAppTokenInput`, `AppTokenCreatedSchema`, `APP_TOKEN_TTL_S`.
- 7d335b2: Workspace membership in the management API: `GET`/`PUT /api/v1/apps/{app}/workspaces/{workspaceId}/members` and `DELETE …/members/{userId}`, with `SetWorkspaceMemberInput`, `WorkspaceRoleSchema` (`owner` | `admin` | `member`) and `WorkspaceMemberSchema` in `@willyim/idp/schemas`. These write the rows the workspaces claim carries; until now nothing could.
