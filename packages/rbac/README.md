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

### React Router loader example

```ts
// app/lib/session.ts
import { auth } from "./permissions"

export async function getSessionContext() {
  const role = await getRoleFromSession()
  const permissions = auth.createChecker(role)
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
  return data?.permissions ?? []
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

- `createChecker(role)` — returns a `PermissionChecker` for the given role
- `permissions` — the original permissions array
- `roles` — the original roles config

### `PermissionChecker<P>`

| Method | Description |
|--------|-------------|
| `has(permission)` | Returns `true` if the permission is granted |
| `require(permission)` | Throws `Response("Forbidden", { status: 403 })` if not granted |
| `granted` | Array of all granted permissions |

### `createPermissionsHook(useGranted)`

| Parameter | Type | Description |
|-----------|------|-------------|
| `useGranted` | `() => P[]` | A React hook or function that returns the granted permissions |

Returns a `usePermissions` hook with:

| Property | Description |
|----------|-------------|
| `has(permission)` | Returns `true` if the permission is granted |
| `granted` | Array of all granted permissions |

## License

MIT
