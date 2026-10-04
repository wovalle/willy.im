---
"@willyim/kit": minor
---

`app.handle(request, ctx, { basePath })` serves `/api/<service>.<method>`, `/openapi.json` and `/llms.txt` under a prefix (`/apps/acme/api/...`), so a tenant can live in the path; the OpenAPI server URL and `llms.txt` name the prefix, and a path outside it is `null`.
