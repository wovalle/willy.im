import { useState } from "react"
import { useNavigate } from "react-router"
import { Fingerprint, Loader2, ShieldCheck } from "lucide-react"

import type { Route } from "./+types/index"
import { authClient } from "~/lib/auth-client"
import { Button } from "~/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "~/components/ui/card"

export function meta() {
  return [
    { title: "idp.willy.im" },
    { name: "description", content: "Identity provider for willy.im" },
  ]
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const session = await context.services.auth.api.getSession({ headers: request.headers })
  return { user: session?.user ?? null }
}

export default function Index({ loaderData }: Route.ComponentProps) {
  const { user } = loaderData
  const navigate = useNavigate()
  const [msg, setMsg] = useState<string | null>(null)
  const [pending, setPending] = useState<null | "signout" | "passkey">(null)

  async function signOut() {
    setPending("signout")
    await authClient.signOut()
    setPending(null)
    navigate("/login")
  }

  async function addPasskey() {
    setMsg(null)
    setPending("passkey")
    const res = await authClient.passkey.addPasskey()
    setPending(null)
    setMsg(res?.error ? (res.error.message ?? "Couldn't add passkey.") : "Passkey added.")
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-6">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <div className="bg-primary/10 text-primary mb-2 flex size-10 items-center justify-center rounded-lg">
            <ShieldCheck className="size-5" />
          </div>
          <CardTitle>idp.willy.im</CardTitle>
          <CardDescription>
            {user ? "You're signed in." : "Identity provider for willy.im projects."}
          </CardDescription>
        </CardHeader>

        {user ? (
          <>
            <CardContent className="flex flex-col gap-1">
              <p className="text-sm font-medium">{user.name || user.email}</p>
              <p className="text-muted-foreground text-sm">{user.email}</p>
              {msg ? <p className="text-muted-foreground mt-2 text-sm">{msg}</p> : null}
            </CardContent>
            <CardFooter className="flex flex-col gap-2">
              <Button variant="outline" className="w-full" onClick={addPasskey} disabled={!!pending}>
                {pending === "passkey" ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Fingerprint className="size-4" />
                )}
                Add a passkey
              </Button>
              <Button className="w-full" onClick={signOut} disabled={!!pending}>
                {pending === "signout" ? <Loader2 className="size-4 animate-spin" /> : null}
                Sign out
              </Button>
            </CardFooter>
          </>
        ) : (
          <CardFooter>
            <Button className="w-full" onClick={() => navigate("/login")}>
              Sign in
            </Button>
          </CardFooter>
        )}
      </Card>
    </main>
  )
}
