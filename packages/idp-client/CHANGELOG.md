# @willyim/idp

## 0.8.0

### Minor Changes

- 01d9a27: App tokens, GitHub-App style: an IdP admin key never goes to an app. `POST /api/v1/apps/{app}/tokens` exchanges it for a short-lived (at most 1h) `wat_` token bound to that app, carrying `["*"]` unless narrowed to `scopes` or one `workspaceId`. `createAppTokens({ baseUrl, token })` mints them: `get(app, { scopes?, workspaceId? })` reuses a token until a minute before it expires, and concurrent callers share one mint. Apps validate app tokens through the existing user-key validation: `UserApiKeyValidationSchema` hits now carry `kind` (`"user"`, or `"app"` with `issuedBy`), and `createUserKeys().authenticate` checks required scopes wildcard-aware (`*`, `ns:*`). New in `@willyim/idp/schemas`: `CreateAppTokenInput`, `AppTokenCreatedSchema`, `APP_TOKEN_TTL_S`.
- 7d335b2: Workspace membership in the management API: `GET`/`PUT /api/v1/apps/{app}/workspaces/{workspaceId}/members` and `DELETE …/members/{userId}`, with `SetWorkspaceMemberInput`, `WorkspaceRoleSchema` (`owner` | `admin` | `member`) and `WorkspaceMemberSchema` in `@willyim/idp/schemas`. These write the rows the workspaces claim carries; until now nothing could.
