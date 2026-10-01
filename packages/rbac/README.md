# @willyim/rbac (deprecated)

**Deprecated.** Permissions are part of [`@willyim/kit`](https://github.com/wovalle/willy.im/tree/main/packages/kit#readme) now. This
package's last release only re-exports kit, so existing imports keep working.

## Move to kit

```sh
npm uninstall @willyim/rbac
npm install @willyim/kit zod
```

| Before | After |
|---|---|
| `import { definePermissions } from "@willyim/rbac"` | `import { definePermissions } from "@willyim/kit"` |
| `import { createPermissionsHook } from "@willyim/rbac/react"` | `import { createPermissionsHook } from "@willyim/kit/react"` |

The API is the same, with two additions in `checkerFor(grants)`:

- `"*"` is a superadmin: `has` is always true and `isSuperadmin` is true. It used to be dropped.
- `definePermissions({ ..., resources: ["thread"] })` accepts instance grants such as
  `"thread:abc"`, and `"thread:*"` for every instance.

See kit's README, section "Grants".

## License

MIT
