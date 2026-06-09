import { useState } from "react"
import { useSearchParams } from "react-router"
import { Check, Loader2, ShieldCheck } from "lucide-react"

import { authClient } from "~/lib/auth-client"
import { Button } from "~/components/ui/button"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "~/components/ui/card"

export function meta() {
  return [{ title: "Authorize · willy.im" }]
}

const SCOPE_LABELS: Record<string, string> = {
  openid: "Verify your identity",
  profile: "Your name and profile info",
  email: "Your email address",
  offline_access: "Stay signed in (refresh access)",
}

export default function Consent() {
  const [params] = useSearchParams()
  const [pending, setPending] = useState<null | "accept" | "deny">(null)
  const [error, setError] = useState<string | null>(null)

  const clientId = params.get("client_id") ?? "An application"
  const scopes = (params.get("scope") ?? "").split(/\s+/).filter(Boolean)

  async function decide(accept: boolean) {
    setError(null)
    setPending(accept ? "accept" : "deny")
    try {
      const { data, error } = await authClient.oauth2.consent({ accept })
      // fetch clients receive { redirect: true, url }; the OpenAPI shape calls it redirect_uri.
      const d = data as { url?: string; redirect_uri?: string } | null
      const redirectUri = d?.url ?? d?.redirect_uri
      if (error || !redirectUri) {
        setPending(null)
        setError(error?.message ?? "Couldn't complete authorization.")
        return
      }
      window.location.href = redirectUri
    } catch {
      setPending(null)
      setError("Couldn't complete authorization.")
    }
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-6">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <div className="bg-primary/10 text-primary mb-2 flex size-10 items-center justify-center rounded-lg">
            <ShieldCheck className="size-5" />
          </div>
          <CardTitle>Authorize access</CardTitle>
          <CardDescription>
            <span className="font-medium">{clientId}</span> wants to sign you in with your willy.im
            account.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {scopes.length > 0 ? (
            <>
              <p className="text-muted-foreground mb-2 text-xs font-medium uppercase tracking-wide">
                It will be able to access
              </p>
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
          {error ? <p className="text-destructive mt-3 text-sm">{error}</p> : null}
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
