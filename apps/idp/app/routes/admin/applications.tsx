import { Form, useActionData, useNavigation } from "react-router"
import { KeyRound, Loader2, Trash2 } from "lucide-react"

import type { Route } from "./+types/applications"
import {
  createApplication,
  deleteApplication,
  listApplications,
  requireAdminSession,
  rotateApplicationSecret,
} from "~/lib/admin.server"
import { Badge } from "~/components/ui/badge"
import { Button } from "~/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card"
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

export async function loader({ request, context }: Route.LoaderArgs) {
  await requireAdminSession(request, context, context.services.auth)
  return { applications: await listApplications(context) }
}

export async function action({ request, context }: Route.ActionArgs) {
  await requireAdminSession(request, context, context.services.auth)
  const form = await request.formData()
  const intent = form.get("intent")

  if (intent === "delete") {
    await deleteApplication(context, String(form.get("clientId")))
    return { ok: true }
  }

  if (intent === "rotate") {
    const created = await rotateApplicationSecret(
      request,
      context.services.auth,
      String(form.get("clientId")),
    )
    return { created, rotated: true }
  }

  const name = String(form.get("name") ?? "").trim()
  const app = String(form.get("app") ?? "").trim()
  const redirectUris = String(form.get("redirectUris") ?? "")
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter(Boolean)

  if (!name || !app || redirectUris.length === 0) {
    return { error: "Name, app key and at least one redirect URI are required." }
  }

  const created = await createApplication(request, context, context.services.auth, {
    name,
    app,
    redirectUris,
  })
  return { created }
}

export default function AdminApplications({ loaderData }: Route.ComponentProps) {
  const { applications } = loaderData
  const actionData = useActionData<typeof action>()
  const nav = useNavigation()
  const busy = nav.state !== "idle"
  const created = actionData && "created" in actionData ? actionData.created : null
  const rotated = actionData && "rotated" in actionData ? actionData.rotated : false
  const error = actionData && "error" in actionData ? actionData.error : null

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>Register an application</CardTitle>
        </CardHeader>
        <CardContent>
          <Form method="post" className="flex flex-col gap-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="name">Name</Label>
                <Input id="name" name="name" placeholder="Invoices" required disabled={busy} />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="app">App key</Label>
                <Input id="app" name="app" placeholder="invoices" required disabled={busy} />
              </div>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="redirectUris">Redirect URIs (space or comma separated)</Label>
              <Input
                id="redirectUris"
                name="redirectUris"
                placeholder="https://invoices.example.com/api/auth/oauth2/callback/willyim"
                required
                disabled={busy}
              />
            </div>
            <Button type="submit" name="intent" value="create" disabled={busy} className="self-start">
              {busy ? <Loader2 className="size-4 animate-spin" /> : null}
              Register
            </Button>
          </Form>

          {error ? <p className="text-destructive mt-3 text-sm">{error}</p> : null}
          {created ? (
            <div className="bg-muted mt-4 rounded-md p-3 text-sm">
              <p className="font-medium">
                {rotated
                  ? "Secret rotated — the old one no longer works. Copy the new secret now, it won't be shown again."
                  : "Application created — copy the secret now, it won't be shown again."}
              </p>
              <p className="mt-2 font-mono text-xs break-all">client_id: {created.clientId}</p>
              <p className="font-mono text-xs break-all">client_secret: {created.clientSecret}</p>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>App key</TableHead>
            <TableHead>Client ID</TableHead>
            <TableHead>Redirect URIs</TableHead>
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {applications.length === 0 ? (
            <TableRow>
              <TableCell colSpan={5} className="text-muted-foreground">
                No applications yet.
              </TableCell>
            </TableRow>
          ) : (
            applications.map((a) => (
              <TableRow key={a.clientId}>
                <TableCell>{a.name ?? "—"}</TableCell>
                <TableCell>{a.app ? <Badge variant="secondary">{a.app}</Badge> : "—"}</TableCell>
                <TableCell className="font-mono text-xs">{a.clientId}</TableCell>
                <TableCell className="text-muted-foreground max-w-[14rem] truncate text-xs">
                  {a.redirectUris.join(", ")}
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-3">
                    <Form method="post">
                      <input type="hidden" name="clientId" value={a.clientId} />
                      <button
                        type="submit"
                        name="intent"
                        value="rotate"
                        aria-label="Rotate client secret"
                        title="Rotate client secret"
                        className="text-muted-foreground hover:text-foreground"
                        disabled={busy}
                      >
                        <KeyRound className="size-4" />
                      </button>
                    </Form>
                    <Form method="post">
                      <input type="hidden" name="clientId" value={a.clientId} />
                      <button
                        type="submit"
                        name="intent"
                        value="delete"
                        aria-label="Delete application"
                        title="Delete application"
                        className="text-muted-foreground hover:text-destructive"
                        disabled={busy}
                      >
                        <Trash2 className="size-4" />
                      </button>
                    </Form>
                  </div>
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  )
}
