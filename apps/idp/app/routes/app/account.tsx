import { useEffect, useState } from "react"
import { useNavigate } from "react-router"
import { Fingerprint, Loader2, Plus, Trash2 } from "lucide-react"

import type { Route } from "./+types/account"
import { requireSession } from "~/lib/admin.server"
import { authClient } from "~/lib/auth-client"
import { Button } from "~/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card"
import { Input } from "~/components/ui/input"

export function meta() {
  return [{ title: "Account · willy.im" }]
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const session = await requireSession(request, context, context.services.auth)
  return { user: { name: session.user.name, email: session.user.email } }
}

type Passkey = { id: string; name?: string | null }

export default function Account({ loaderData }: Route.ComponentProps) {
  const { user } = loaderData
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
    refreshPasskeys()
  }, [])

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
      // User dismissed the system prompt — nothing to report.
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
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>{user.name || user.email}</CardTitle>
          <CardDescription>{user.email}</CardDescription>
        </CardHeader>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Passkeys</CardTitle>
          <CardDescription>Sign in without a code, using your device or password manager.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {passkeys === null ? (
            <Loader2 className="text-muted-foreground size-4 animate-spin" />
          ) : passkeys.length === 0 ? (
            <p className="text-muted-foreground text-sm">No passkeys yet. Add one below.</p>
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
                    aria-label={`Delete passkey ${pk.name ?? ""}`}
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

          <form onSubmit={addPasskey} className="flex gap-2">
            <Input
              aria-label="Passkey name"
              placeholder="Name (e.g. 1Password, MacBook)"
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={!!pending}
            />
            <Button type="submit" variant="outline" disabled={!!pending || !name.trim()}>
              {pending === "add" ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
              Add passkey
            </Button>
          </form>
          {error ? (
            <p role="alert" className="text-destructive text-sm">
              {error}
            </p>
          ) : null}
        </CardContent>
      </Card>

      <div>
        <Button variant="outline" onClick={signOut} disabled={!!pending}>
          {pending === "signout" ? <Loader2 className="size-4 animate-spin" /> : null}
          Sign out
        </Button>
      </div>
    </div>
  )
}
