---
"@willyim/idp": major
---

The management API moves onto the IdP's semantic methods (served by `@willyim/kit`). `createUserKeys`, `createAppTokens` and `createIdentities` keep their signatures; underneath they now call `POST /apps/<app>/api/user_keys.validate` (`.list`, `.mint`, `.revoke`), `app_tokens.mint` and `identities.resolve` instead of `/api/v1`, so they need an IdP that serves those (this release's).

New: `createManagementApi(...).call("members.invite", input, { app })` reaches every method, typed from the `methods` table in `@willyim/idp/schemas` (name → scope, input, output), which the IdP's method contracts are written from. Errors are the IdP's as they arrive, in an `IdpError`: 400 `{ error, fields }` for invalid input (it was 422 `validation_error`), `{ error }` with a message otherwise; refused scopes stay 422 and an unreadable resource list 502.

`MemberSchema` gains `productPermissions` (default `[]`); `InviteMemberInput.email` is trimmed.

`request(method, "/api/v1/…")` still works against the IdP's `/api/v1`, which is kept until every app is on this major.
