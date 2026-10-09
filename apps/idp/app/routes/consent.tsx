import { useState } from "react"
import { Check, Loader2, ShieldCheck } from "lucide-react"

import type { Route } from "./+types/consent"
import { authClient, authErrorText } from "~/lib/auth-client"
import { consentClient } from "~/lib/consent.server"
import { signedQueryExpired } from "~/lib/oauth-query"
import { Button } from "~/components/ui/button"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "~/components/ui/card"
import { appContext } from "~/context"

export function meta() {
  return [{ title: "Authorize · willy.im" }]
}

// The plugin sends the user here with the authorization request on the query
// (client_id, scope, redirect_uri, …, signed). client_id is an opaque id, so
// the client is looked up and named by what it registered.
export async function loader({ request, context: router }: Route.LoaderArgs) {
  const context = router.get(appContext)
  const params = new URL(request.url).searchParams
  return {
    client: await consentClient(context, params.get("client_id"), params.get("redirect_uri")),
    scopes: (params.get("scope") ?? "").split(/\s+/).filter(Boolean),
  }
}

const SCOPE_LABELS: Record<string, string> = {
  openid: "Verify your identity",
  profile: "Your name and profile info",
  email: "Your email address",
  offline_access: "Stay signed in (refresh access)",
}

export default function Consent({ loaderData }: Route.ComponentProps) {
  const { client, scopes } = loaderData
  const [pending, setPending] = useState<null | "accept" | "deny">(null)
  const [error, setError] = useState<string | null>(null)

  async function decide(accept: boolean) {
    setError(null)
    // Past its expiry the server rejects this decision (see oauth-query.ts), and
    // the app's half of the handshake is as stale: it has to start over.
    if (signedQueryExpired(window.location.search)) {
      setError(`This request expired. Go back to ${client.name} and sign in again.`)
      return
    }
    setPending(accept ? "accept" : "deny")
    try {
      const { data, error } = await authClient.oauth2.consent({ accept })
      // fetch clients receive { redirect: true, url }; the OpenAPI shape calls it redirect_uri.
      const d = data as { url?: string; redirect_uri?: string } | null
      const redirectUri = d?.url ?? d?.redirect_uri
      if (error || !redirectUri) {
        setPending(null)
        setError(error ? authErrorText(error, "Couldn't complete authorization.") : "Couldn't complete authorization.")
        return
      }
      window.location.href = redirectUri
    } catch {
      setPending(null)
      setError("Couldn't complete authorization.")
    }
  }

  return (
    <main id="main" className="flex min-h-screen flex-col items-center justify-center p-6">
      <Card className="w-full max-w-sm">
        <CardHeader>
          {client.icon ? (
            <img
              src={client.icon}
              alt=""
              referrerPolicy="no-referrer"
              className="mb-2 size-10 rounded-lg object-contain"
            />
          ) : (
            <div className="bg-primary/10 text-primary mb-2 flex size-10 items-center justify-center rounded-lg">
              <ShieldCheck aria-hidden="true" className="size-5" />
            </div>
          )}
          <CardTitle>Authorize access</CardTitle>
          <CardDescription>
            <span className="text-foreground font-medium">{client.name}</span> wants to sign you in
            with your willy.im account.
            {client.host ? <span className="mt-1 block text-xs">Returns you to {client.host}</span> : null}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {scopes.length > 0 ? (
            <>
              <h2 className="text-muted-foreground mb-2 text-xs font-medium uppercase tracking-wide">
                It will be able to access
              </h2>
              <ul className="flex flex-col gap-2">
                {scopes.map((s) => (
                  <li key={s} className="flex items-start gap-2 text-sm">
                    <Check className="text-primary mt-0.5 size-4 shrink-0" />
                    {SCOPE_LABELS[s] ?? s}
                  </li>
                ))}
              </ul>
            </>
          ) : null}
          {error ? (
            <p className="text-destructive mt-3 text-sm" role="alert">
              {error}
            </p>
          ) : null}
        </CardContent>
        <CardFooter className="flex flex-col gap-2">
          <Button className="w-full" onClick={() => decide(true)} disabled={!!pending}>
            {pending === "accept" ? <Loader2 className="size-4 animate-spin" /> : null}
            Allow
          </Button>
          <Button
            variant="ghost"
            className="w-full"
            onClick={() => decide(false)}
            disabled={!!pending}
          >
            {pending === "deny" ? <Loader2 className="size-4 animate-spin" /> : null}
            Deny
          </Button>
        </CardFooter>
      </Card>
    </main>
  )
}
