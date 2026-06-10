import { useEffect, useRef, useState } from "react"
import { useSearchParams } from "react-router"
import { Loader2 } from "lucide-react"

import { authClient } from "~/lib/auth-client"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card"

export function meta() {
  return [{ title: "Signing in · willy.im" }]
}

/**
 * Target of the sign-in link embedded in the OTP email
 * (/login/verify?email=&code=). Auto-submits the carried code so clicking the
 * link signs the user in without typing.
 */
export default function LoginVerify() {
  const [params] = useSearchParams()
  const [error, setError] = useState<string | null>(null)
  const ran = useRef(false)

  const email = params.get("email") ?? ""
  const code = params.get("code") ?? ""

  useEffect(() => {
    if (ran.current) return
    ran.current = true

    if (!email || !code) {
      setError("This sign-in link is missing information.")
      return
    }

    authClient.signIn.emailOtp({ email, otp: code }).then(({ error }) => {
      if (error) setError(error.message ?? "This sign-in link is invalid or expired.")
      // Full-document load so the session cookie is sent on the next request.
      else window.location.assign("/")
    })
  }, [email, code])

  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-6">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>Signing you in</CardTitle>
          <CardDescription>{error ? "Something went wrong." : "One moment…"}</CardDescription>
        </CardHeader>
        <CardContent>
          {error ? (
            <p className="text-destructive text-sm">
              {error}{" "}
              <a href="/login" className="underline">
                Try again
              </a>
              .
            </p>
          ) : (
            <Loader2 className="text-muted-foreground size-5 animate-spin" />
          )}
        </CardContent>
      </Card>
    </main>
  )
}
