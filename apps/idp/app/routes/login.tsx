import { useState } from "react"
import { useNavigate } from "react-router"
import { Fingerprint, Loader2, Mail } from "lucide-react"

import { authClient } from "~/lib/auth-client"
import { Button } from "~/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "~/components/ui/card"
import { Input } from "~/components/ui/input"
import { Label } from "~/components/ui/label"

export function meta() {
  return [{ title: "Sign in · willy.im" }]
}

type Step = "email" | "otp"

export default function Login() {
  const navigate = useNavigate()
  const [step, setStep] = useState<Step>("email")
  const [email, setEmail] = useState("")
  const [code, setCode] = useState("")
  const [pending, setPending] = useState<null | "email" | "otp" | "passkey">(null)
  const [error, setError] = useState<string | null>(null)

  const busy = pending !== null

  async function sendCode(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setPending("email")
    const { error } = await authClient.emailOtp.sendVerificationOtp({ email, type: "sign-in" })
    setPending(null)
    if (error) return setError(error.message ?? "Couldn't send the code.")
    setStep("otp")
  }

  // When an OIDC authorization is pending, the oauth-provider client attaches the
  // signed query to the sign-in request and the server returns a URL to resume the
  // flow (→ consent or back to the client). Honor it instead of going home.
  function continueAfterSignIn(data: unknown) {
    const url = (data as { url?: string } | null)?.url
    if (url) window.location.href = url
    else navigate("/")
  }

  async function verifyCode(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setPending("otp")
    const { data, error } = await authClient.signIn.emailOtp({ email, otp: code })
    setPending(null)
    if (error) return setError(error.message ?? "Invalid or expired code.")
    continueAfterSignIn(data)
  }

  async function signInWithPasskey() {
    setError(null)
    setPending("passkey")
    try {
      const res = await authClient.signIn.passkey()
      if (res?.error) {
        setError(res.error.message ?? "Passkey sign-in failed.")
        return
      }
      continueAfterSignIn(res?.data)
    } catch {
      // User dismissed the system passkey prompt — leave the form as-is.
    } finally {
      setPending(null)
    }
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-6">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>Sign in to willy.im</CardTitle>
          <CardDescription>
            {step === "email"
              ? "One identity across willy.im projects."
              : `We sent a code to ${email}.`}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {step === "email" ? (
            <>
              <form onSubmit={sendCode} className="flex flex-col gap-3">
                <div className="flex flex-col gap-2">
                  <Label htmlFor="email">Email</Label>
                  <Input
                    id="email"
                    type="email"
                    autoComplete="email webauthn"
                    placeholder="you@example.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    disabled={busy}
                  />
                </div>
                <Button type="submit" disabled={busy || !email}>
                  {pending === "email" ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Mail className="size-4" />
                  )}
                  Continue with email
                </Button>
              </form>

              <div className="flex items-center gap-3">
                <div className="bg-border h-px flex-1" />
                <span className="text-muted-foreground text-xs">or</span>
                <div className="bg-border h-px flex-1" />
              </div>

              <Button variant="outline" onClick={signInWithPasskey} disabled={busy}>
                {pending === "passkey" ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Fingerprint className="size-4" />
                )}
                Sign in with a passkey
              </Button>
            </>
          ) : (
            <form onSubmit={verifyCode} className="flex flex-col gap-3">
              <div className="flex flex-col gap-2">
                <Label htmlFor="code">Verification code</Label>
                <Input
                  id="code"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  placeholder="123456"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  required
                  disabled={busy}
                />
              </div>
              <Button type="submit" disabled={busy || code.length < 6}>
                {pending === "otp" ? <Loader2 className="size-4 animate-spin" /> : null}
                Verify &amp; sign in
              </Button>
              <Button
                type="button"
                variant="ghost"
                disabled={busy}
                onClick={() => {
                  setStep("email")
                  setCode("")
                  setError(null)
                }}
              >
                Use a different email
              </Button>
            </form>
          )}

          {error ? <p className="text-destructive text-sm">{error}</p> : null}
        </CardContent>
      </Card>
    </main>
  )
}
