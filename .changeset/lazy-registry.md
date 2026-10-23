---
"@willyim/kit": minor
---

`createApp` no longer builds the registry. Building it runs every service factory (and every method's schemas) against an empty context, which each cold start paid for although only the adapters and discovery read it. The registry is now built on first use, and the view check moved into `registry()` with the tool-name and empty-context checks. Call `registry(app)` in a test to keep those failing in CI instead of on the first request that needs the registry.
