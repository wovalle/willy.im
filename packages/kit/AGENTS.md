# @willyim/kit: agent instructions

Working on kit itself, or on an app built with it? Read the README first:

- [README → For agents](README.md#for-agents): the rules for writing services and methods.
- [README → The contract](README.md#the-contract): what each contract field means, and the
  order a call runs in.
- [README → Principals and tenants](README.md#principals-and-tenants): how a request becomes
  `ctx.caller`. The tenant comes from `ctx.tenantId`, never from method input.
- [README → Logging](README.md#logging-willyimkitlog): `@willyim/kit/log`, event naming, what to
  log and what not to, levels, and `jq` recipes for prod logs. Never `console.log` in a kit app.

Working on this package:

- `npm run build`, `npm run typecheck` (includes `test/types.check.ts`, the compile-time
  contract checks) and `npm test` (vitest) must pass.
- Tests describe behaviour; name each one as a line of the spec.
- Every change ships with a changeset (`npx changeset` at the repo root).
