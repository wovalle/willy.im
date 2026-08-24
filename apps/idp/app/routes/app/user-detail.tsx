import { Form, Link, useActionData, useNavigation, useSubmit } from "react-router"
import { Link2, Loader2, Plus, Trash2 } from "lucide-react"

import type { Route } from "./+types/user-detail"
import { getUser } from "~/lib/admin.server"
import { requireConsoleCaller } from "~/lib/caller.server"
import {
  linkIdentity,
  listLinkedIdentities,
  unlinkIdentity,
} from "~/lib/identities.server"
import { Avatar } from "~/components/avatar"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "~/components/ui/alert-dialog"
import { Badge } from "~/components/ui/badge"
import { Button } from "~/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card"
import { Input } from "~/components/ui/input"
import { Label } from "~/components/ui/label"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "~/components/ui/table"

// The systems we know how to talk to. Free text would work — the service just
// lowercases whatever it's given — but a fixed set keeps the console honest
// about which providers actually resolve elsewhere in the IdP.
const PROVIDERS = ["slack", "whatsapp", "telegram"] as const

export async function loader({ request, context, params }: Route.LoaderArgs) {
  // Linking is superadmin-only in the service; gate the page the same way so a
  // non-admin never sees controls that would only 403.
  const caller = await requireConsoleCaller(request, context, context.services.auth, {
    superadmin: true,
  })
  const user = await getUser(context, params.userId)
  if (!user) throw new Response("User not found", { status: 404 })
  const identities = await listLinkedIdentities(context, caller, { userId: params.userId })
  return { user, identities }
}

export async function action({ request, context, params }: Route.ActionArgs) {
  const caller = await requireConsoleCaller(request, context, context.services.auth, {
    superadmin: true,
  })
  const form = await request.formData()
  const intent = form.get("intent")

  if (intent === "link") {
    const provider = String(form.get("provider") ?? "").trim()
    const externalId = String(form.get("externalId") ?? "").trim()
    const label = String(form.get("label") ?? "").trim()
    if (!provider) return { error: "Choose a provider.", field: "link" }
    if (!externalId) return { error: "Enter the external id.", field: "link" }
    const res = await linkIdentity(context, caller, {
      userId: params.userId,
      provider,
      externalId,
      label: label || null,
    })
    if ("error" in res) {
      // The pair is unique: it either belongs to nobody (link it) or to someone
      // else (refuse — silently re-pointing an identity hands one person
      // another's grants).
      if (res.error === "unknown_user") return { error: "This user no longer exists.", field: "link" }
      return {
        error: `${provider}:${externalId} is already linked to another user.`,
        field: "link",
      }
    }
    return { ok: res.created ? "linked" : "already-yours" }
  }

  if (intent === "unlink") {
    await unlinkIdentity(context, caller, {
      userId: params.userId,
      id: String(form.get("id") ?? ""),
    })
    return { ok: "unlinked" }
  }

  return { error: "Unknown action" }
}

export default function UserDetail({ loaderData }: Route.ComponentProps) {
  const { user, identities } = loaderData
  const actionData = useActionData<typeof action>()
  const nav = useNavigation()
  const busy = nav.state !== "idle"

  const error = actionData && "error" in actionData ? actionData.error : null
  const field = actionData && "field" in actionData ? actionData.field : null

  return (
    <div className="flex flex-col gap-6">
      {/* Breadcrumb-as-title: the back link is the trail, the leaf is the h1. */}
      <div className="flex items-center gap-2">
        <Avatar userId={user.id} src={user.image} size={32} />
        <div className="flex items-baseline gap-1.5">
          <Link
            to="/users"
            className="text-muted-foreground hover:text-foreground text-xl font-semibold tracking-tight no-underline transition-colors"
          >
            Users
          </Link>
          <span className="text-muted-foreground text-xl font-semibold">/</span>
          <h1 className="text-xl font-semibold tracking-tight">{user.name || user.email}</h1>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Link2 className="text-muted-foreground size-4" />
            Linked identities
          </CardTitle>
          <CardDescription>
            This user's ids on other systems (Slack, WhatsApp, Telegram), pinned so every surface
            resolves them to the same IdP user. A pair can belong to only one user.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-6">
          <LinkIdentityForm busy={busy} error={field === "link" ? (error ?? null) : null} />

          {identities.length === 0 ? (
            <p className="text-muted-foreground text-sm">No linked identities yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Provider</TableHead>
                  <TableHead>External id</TableHead>
                  <TableHead>Label</TableHead>
                  <TableHead>Linked</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {identities.map((i) => (
                  <IdentityRow key={i.id} identity={i} busy={busy} />
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

/** Pin an external id to this user: provider + external id + optional label. */
function LinkIdentityForm({ busy, error }: { busy: boolean; error: string | null }) {
  const selectClass =
    "border-input bg-transparent focus-visible:ring-ring/50 h-9 rounded-md border px-2 text-sm shadow-xs focus-visible:ring-[3px] focus-visible:outline-none"
  return (
    <Form method="post" className="flex flex-col gap-3 rounded-lg border p-4">
      <input type="hidden" name="intent" value="link" />
      <div className="flex flex-wrap items-end gap-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="provider">Provider</Label>
          <select id="provider" name="provider" disabled={busy} className={selectClass}>
            {PROVIDERS.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-1 flex-col gap-1.5">
          <Label htmlFor="externalId">External id</Label>
          <Input
            id="externalId"
            name="externalId"
            placeholder="U01ABC23DEF"
            required
            aria-invalid={!!error}
            disabled={busy}
            className="font-mono"
          />
        </div>
        <div className="flex flex-1 flex-col gap-1.5">
          <Label htmlFor="label">Label (optional)</Label>
          <Input id="label" name="label" placeholder="work Slack" disabled={busy} />
        </div>
        <Button type="submit" disabled={busy}>
          {busy ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
          Link
        </Button>
      </div>
      {error ? (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      ) : null}
    </Form>
  )
}

type IdentityRowData = {
  id: string
  provider: string
  externalId: string
  label: string | null
  createdAt: string | Date
}

/** A single linked identity with an inline unlink confirmation. */
function IdentityRow({ identity, busy }: { identity: IdentityRowData; busy: boolean }) {
  const submit = useSubmit()
  return (
    <TableRow>
      <TableCell>
        <Badge variant="secondary">{identity.provider}</Badge>
      </TableCell>
      <TableCell>
        <code className="font-mono text-xs">{identity.externalId}</code>
      </TableCell>
      <TableCell className="text-muted-foreground">{identity.label || "—"}</TableCell>
      <TableCell className="text-muted-foreground text-xs whitespace-nowrap">
        {new Date(identity.createdAt as string).toLocaleDateString()}
      </TableCell>
      <TableCell className="text-right whitespace-nowrap">
        <AlertDialog>
          <AlertDialogTrigger
            render={
              <Button variant="ghost" size="sm" className="text-destructive" disabled={busy}>
                <Trash2 className="size-3.5" />
                Unlink
              </Button>
            }
          />
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>
                Unlink {identity.provider}:{identity.externalId}?
              </AlertDialogTitle>
              <AlertDialogDescription>
                Any surface that resolves this {identity.provider} id will stop finding this user.
                You can re-link it later.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                variant="destructive"
                onClick={() => submit({ intent: "unlink", id: identity.id }, { method: "post" })}
              >
                Unlink
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </TableCell>
    </TableRow>
  )
}
