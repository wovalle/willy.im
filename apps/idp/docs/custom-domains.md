# Vanity IdP domains (`idp.{your-domain}`)

The IdP can serve auth on any number of vanity hostnames (e.g. `idp.kasso.do`)
backed by the same worker, database, and user store. Each domain gets its own
issuer, cookies, and passkey RP — first-party auth per domain, by design.
There is **no cross-domain SSO**: signing in on `idp.kasso.do` does not sign
you in on `idp.willy.im` (separate cookies).

## App-side configuration

1. Add the hostname to `IDP_EXTRA_DOMAINS` in `wrangler.jsonc` (comma-separated):

   ```jsonc
   "vars": { "IDP_EXTRA_DOMAINS": "idp.kasso.do" }
   ```

2. Register the consumer app's OAuth client with redirect URIs on its own
   domain (e.g. `https://app.kasso.do/auth/callback`).

3. The consumer points its OIDC discovery at the vanity host:
   `https://idp.kasso.do/.well-known/openid-configuration` — issuer, endpoints
   and tokens all come back on that host. JWKS keys are shared, so tokens
   verify regardless of which host minted them.

## DNS / TLS — pick one

**A. Zone already on the Cloudflare account (simplest).** Add a custom-domain
route to `wrangler.jsonc` and deploy; Cloudflare creates the DNS record and
certificate automatically:

```jsonc
"routes": [
  { "pattern": "idp.willy.im", "custom_domain": true },
  { "pattern": "idp.kasso.do", "custom_domain": true },
]
```

**B. Zone on another Cloudflare account.** Use Cloudflare for SaaS (custom
hostnames) on the willy.im zone with `idp.willy.im` as fallback origin, then
CNAME `idp.kasso.do → idp.willy.im` from the other account. TLS is issued via
the SaaS hostname validation.

**C. Not on Cloudflare at all.** CNAME `idp.kasso.do` to a box running Caddy:

```caddyfile
idp.kasso.do {
  reverse_proxy https://idp.willy.im {
    header_up Host {host}          # preserve the vanity host — REQUIRED
    header_up X-Forwarded-Host {host}
  }
}
```

The worker keys everything off the incoming `Host` header, so the proxy must
pass it through unchanged (the default `reverse_proxy` rewrites it).

## Caveats

- **Passkeys are per-domain.** A passkey registered on `idp.willy.im` has
  rpID `idp.willy.im` and will not be offered on `idp.kasso.do`. Users
  register one per domain they actually use (or use email OTP).
- **Sessions are per-domain.** Same email = same account everywhere, but each
  vanity domain has its own session cookie.
- Unknown hosts (not in `IDP_EXTRA_DOMAINS`) fall back to the canonical
  `BETTER_AUTH_URL` — a stray CNAME can't mint tokens for an arbitrary issuer.
