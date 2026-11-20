---
"@willyim/idp": patch
"@willyim/kit": patch
---

Fix an open redirect in `safeNext`: it rejected `//host` but let `/\host`, `/%5Chost` and `/%09/host` through, which browsers follow off-site after sign-in. It now accepts only same-origin absolute paths — a single leading `/` not followed by `/` or `\`, no backslash, control character or whitespace in the raw or percent-decoded value, and resolving to the same origin — and `completeLogin` re-checks the `next` it reads back from the state cookie. Paths with encoded whitespace (`/search?q=a%20b`) or malformed percent-encoding now fall back to the default redirect. kit picks up the fixed idp.
