# @willyim/drizzle-audit (deprecated)

**Deprecated.** Audit logging is part of [`@willyim/kit`](https://github.com/wovalle/willy.im/tree/main/packages/kit#readme) now, as
`@willyim/kit/audit`. This package's last release only re-exports kit, so existing imports and the `drizzle-audit` CLI keep working.

## Move to kit

```sh
npm uninstall @willyim/drizzle-audit
npm install @willyim/kit drizzle-orm
```

| Before                                  | After                                   |
| --------------------------------------- | --------------------------------------- |
| `@willyim/drizzle-audit`                | `@willyim/kit/audit`                    |
| `@willyim/drizzle-audit/postgres`       | `@willyim/kit/audit/postgres`           |
| `@willyim/drizzle-audit/context`        | `@willyim/kit/audit/context`            |
| `@willyim/drizzle-audit/d1`             | `@willyim/kit/audit/d1`                 |
| `@willyim/drizzle-audit/d1-runtime`     | `@willyim/kit/audit/d1-runtime`         |
| `drizzle-audit generate --config ...`   | `kit-audit generate --config ...`       |

The API is unchanged. The CLI keeps its flags, the `-- drizzle-audit <hash>` marker and the
`.drizzle-audit.json` state file, so existing migrations are recognised.

See kit's README, section "Audit".

## License

MIT
