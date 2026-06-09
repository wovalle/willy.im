import { useEffect, useState } from "react"
import { useNavigate } from "react-router"
import { Fingerprint, Loader2, Plus, ShieldCheck, SlidersHorizontal, Trash2 } from "lucide-react"

import type { Route } from "./+types/index"
import { authClient } from "~/lib/auth-client"
import { isAdminEmail } from "~/lib/admin.server"
import { Button } from "~/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "~/components/ui/card"
import { Input } from "~/components/ui/input"

export function meta() {
  return [
    { title: "idp.willy.im" },
    { name: "description", content: "Identity provider for willy.im" },
  ]
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const session = await context.services.auth.api.getSession({ headers: request.headers })
  return {
    user: session?.user ?? null,
    isAdmin: isAdminEmail(context, session?.user.email),
  }
}

type Passkey = { id: string; name?: string | null; createdAt: string | Date }

export default function Index({ loaderData }: Route.ComponentProps) {
  const { user, isAdmin } = loaderData
  const navigate = useNavigate()
  const [pending, setPending] = useState<null | "signout" | "add" | string>(null)
  const [error, setError] = useState<string | null>(null)
  const [name, setName] = useState("")
  const [passkeys, setPasskeys] = useState<Passkey[] | null>(null)

  async function refreshPasskeys() {
    const { data } = await authClient.passkey.listUserPasskeys()
    setPasskeys((data as Passkey[]) ?? [])
  }

  useEffect(() => {
    if (user) refreshPasskeys()
  }, [user])

  async function signOut() {
    setPending("signout")
    await authClient.signOut()
    navigate("/login")
  }

  async function addPasskey(e: React.FormEvent) {
    e.preventDefault()
    const trimmed = name.trim()
    if (!trimmed) {
      setError("Give the passkey a name first.")
      return
    }
    setError(null)
    setPending("add")
    try {
      const res = await authClient.passkey.addPasskey({ name: trimmed })
      if (res?.error) {
        setError(res.error.message ?? "Couldn't add passkey.")
        return
      }
      setName("")
      await refreshPasskeys()
    } catch {
      // User dismissed the system prompt (or it timed out) — not an error worth shouting about.
    } finally {
      setPending(null)
    }
  }

  async function removePasskey(id: string) {
    setError(null)
    setPending(id)
    try {
      await authClient.passkey.deletePasskey({ id })
      await refreshPasskeys()
    } finally {
      setPending(null)
    }
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
            <CardContent className="flex flex-col gap-4">
              <div>
                <p className="text-sm font-medium">{user.name || user.email}</p>
                <p className="text-muted-foreground text-sm">{user.email}</p>
              </div>

              <div className="flex flex-col gap-2">
                <p className="text-muted-foreground text-xs font-medium uppercase tracking-wide">
                  Passkeys
                </p>
                {passkeys === null ? (
                  <Loader2 className="text-muted-foreground size-4 animate-spin" />
                ) : passkeys.length === 0 ? (
                  <p className="text-muted-foreground text-sm">No passkeys yet.</p>
                ) : (
                  <ul className="flex flex-col gap-1">
                    {passkeys.map((pk) => (
                      <li
                        key={pk.id}
                        className="flex items-center justify-between gap-2 rounded-md border px-3 py-2"
                      >
                        <span className="flex items-center gap-2 text-sm">
                          <Fingerprint className="text-muted-foreground size-4" />
                          {pk.name || "Unnamed passkey"}
                        </span>
                        <button
                          type="button"
                          aria-label="Delete passkey"
                          onClick={() => removePasskey(pk.id)}
                          disabled={!!pending}
                          className="text-muted-foreground hover:text-destructive disabled:opacity-50"
                        >
                          {pending === pk.id ? (
                            <Loader2 className="size-4 animate-spin" />
                          ) : (
                            <Trash2 className="size-4" />
                          )}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}

                <form onSubmit={addPasskey} className="mt-1 flex gap-2">
                  <Input
                    placeholder="Name (e.g. 1Pass, MacBook)"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    disabled={!!pending}
                  />
                  <Button type="submit" variant="outline" disabled={!!pending || !name.trim()}>
                    {pending === "add" ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <Plus className="size-4" />
                    )}
                    Add
                  </Button>
                </form>
              </div>

              {error ? <p className="text-destructive text-sm">{error}</p> : null}
            </CardContent>
            <CardFooter className="flex flex-col gap-2">
              {isAdmin ? (
                <Button
                  variant="outline"
                  className="w-full"
                  onClick={() => navigate("/admin")}
                  disabled={!!pending}
                >
                  <SlidersHorizontal className="size-4" />
                  Admin console
                </Button>
              ) : null}
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
