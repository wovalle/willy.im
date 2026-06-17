# @willyim/rbac

Typed RBAC where permissions are the primitive and roles are named permission bags.

Define your permissions once, get fully typed checkers for your server loaders and a hook factory for your React components.

## Install

```bash
npm install @willyim/rbac
```

## Define permissions

```ts
import { definePermissions } from "@willyim/rbac"

export const auth = definePermissions({
  permissions: [
    "contacts:read",
    "contacts:import",
    "reports:read",
    "calendar:read",
    "calendar:read-all",
    "settings:read",
    "settings:manage",
  ] as const,
  roles: {
    admin: [
      "contacts:read",
      "contacts:import",
      "reports:read",
      "calendar:read",
      "calendar:read-all",
      "settings:read",
      "settings:manage",
    ],
    agent: ["contacts:read", "calendar:read", "settings:read"],
  },
})

// Derive types from your config
export type Permission = (typeof auth.permissions)[number]
export type Role = keyof typeof auth.roles
```

Permissions and roles are inferred from your config — typos in role arrays are caught at compile time.

## Check permissions (server)

`createChecker` returns a `PermissionChecker` scoped to a role. Use it in loaders, middleware, or anywhere on the server.

```ts
const checker = auth.createChecker("agent")

checker.has("contacts:read") // true
checker.has("reports:read") // false

// Throws a 403 Response if the permission is not granted
checker.require("reports:read") // throws Response("Forbidden", { status: 403 })
```

### Superadmin

Pass `{ superadmin: true }` to grant all permissions regardless of role. The library handles the semantics; your app decides who is a superadmin.

```ts
const checker = auth.createChecker("agent", { superadmin: isSuperAdmin(user.email) })

checker.has("reports:read")   // true — superadmin bypasses role restrictions
checker.isSuperadmin          // true
checker.granted               // all permissions in the system
```

Add superadmin-only features as permissions that no role lists. Only superadmins (via the flag) will ever have them:

```ts
// permissions.ts
export const auth = definePermissions({
  permissions: ["contacts:read", /* ... */, "jobs:manage"] as const,
  roles: {
    admin: ["contacts:read", /* ... */],  // jobs:manage not listed — only superadmins get it
  },
})

// route loader
if (!permissions.has("jobs:manage")) throw new Response("Not Found", { status: 404 })
```

### React Router loader example

```ts
// app/lib/session.ts
import { auth } from "./permissions"

export async function getSessionContext() {
  const role = await getRoleFromSession()
  const permissions = auth.createChecker(role, { superadmin: isSuperAdmin(user.email) })
  return { permissions, /* ... */ }
}

// app/routes/reports.tsx
export async function loader({ context }: Route.LoaderArgs) {
  const { permissions } = await context.getSessionContext()
  permissions.require("reports:read")
  return { /* ... */ }
}
```

## Check permissions (React)

The `@willyim/rbac/react` entry point exports `createPermissionsHook`, a factory that builds a typed `usePermissions` hook from any data source.

```ts
// app/hooks/use-permissions.ts
import { createPermissionsHook } from "@willyim/rbac/react"
import { useRouteLoaderData } from "react-router"
import type { Permission } from "../lib/permissions"

export const usePermissions = createPermissionsHook<Permission>(() => {
  const data = useRouteLoaderData("routes/_dashboard_layout")
  return {
    granted: data?.permissions.granted ?? [],
    isSuperadmin: data?.permissions.isSuperadmin ?? false,
  }
})
```

Then use it in components:

```tsx
function Nav() {
  const { has } = usePermissions()

  return (
    <nav>
      <Link to="/">Home</Link>
      {has("reports:read") && <Link to="/reports">Reports</Link>}
      {has("settings:manage") && <Link to="/settings">Settings</Link>}
    </nav>
  )
}
```

## API

### `definePermissions(config)`

| Parameter | Type | Description |
|-----------|------|-------------|
| `config.permissions` | `readonly string[]` | All permissions in the system (use `as const`) |
| `config.roles` | `Record<string, readonly Permission[]>` | Each role maps to a subset of permissions |

Returns an object with:

- `createChecker(role, opts?)` — returns a `PermissionChecker` for the given role
- `permissions` — the original permissions array
- `roles` — the original roles config

### `PermissionChecker<P>`

| Member | Description |
|--------|-------------|
| `has(permission)` | Returns `true` if the permission is granted (always `true` for superadmin) |
| `require(permission)` | Throws `Response("Forbidden", { status: 403 })` if not granted (never throws for superadmin) |
| `granted` | Array of all granted permissions (all permissions for superadmin) |
| `isSuperadmin` | `true` when the checker was created with `{ superadmin: true }` |

### `CheckerOptions`

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `superadmin` | `boolean` | `false` | When `true`, all `has()` checks pass and `granted` returns every permission |

### `createPermissionsHook(useData)`

| Parameter | Type | Description |
|-----------|------|-------------|
| `useData` | `() => { granted: P[], isSuperadmin?: boolean }` | A React hook that returns permissions data from your loader |

Returns a `usePermissions` hook with:

| Property | Description |
|----------|-------------|
| `has(permission)` | Returns `true` if the permission is granted |
| `granted` | Array of all granted permissions |
| `isSuperadmin` | `true` when the data source explicitly sets it (not inferred) |

## License

MIT
