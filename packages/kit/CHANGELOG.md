# @willyim/kit

## 0.1.0

### Minor Changes

- 07352da: First release of `@willyim/kit`: typed methods with contracts (`summary`, `description`, `permission`, `input`, `output`, `when`, `hints`, `name`), served to the UI, an HTTP API with OpenAPI and `llms.txt`, MCP (`@willyim/kit/mcp`) and any agent runtime (`tools(app, ctx)`), with an `onCall` hook, `kitImage` outputs and `discovery: { anonymous: "all" | "none", auth? }` (closed discovery tells unauthenticated callers how to log in). It absorbs `@willyim/rbac` (now with `"*"` superadmin and instance grants for declared `resources`) and re-exports `@willyim/idp` as `@willyim/kit/idp`.

  `@willyim/rbac` is deprecated: this release only re-exports `@willyim/kit`.
