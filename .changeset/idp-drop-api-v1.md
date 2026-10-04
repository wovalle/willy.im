---
"@willyim/idp": major
---

The IdP no longer serves `/api/v1`, and the SDK drops what spoke it: `createManagementApi(...).request(method, "/api/v1/…")`, the `@willyim/idp/schemas/openapi` entry point (`buildOpenApiDocument`) and the `openapi/idp-api.json` snapshot are gone. `call("<service>.<method>", input, { app })` reaches every method; the IdP serves each caller's OpenAPI document at `/openapi.json` (`/apps/<app>/openapi.json` inside an app), with `/llms.txt` beside it.
