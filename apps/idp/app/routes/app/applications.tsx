import { useRef, useState } from "react"
import { Form, Link, useActionData, useNavigation } from "react-router"
import { ChevronRight, Loader2, Plus } from "lucide-react"

import type { Route } from "./+types/applications"
import { createApplication, listApplications } from "~/lib/admin.server"
import { requireConsoleCaller } from "~/lib/caller.server"
import { firstInvalidRedirectUri, parseUriList } from "~/lib/validate"
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
  await requireConsoleCaller(request, context, context.services.auth, { superadmin: true })
  return { applications: await listApplications(context) }
}

export async function action({ request, context }: Route.ActionArgs) {
  const caller = await requireConsoleCaller(request, context, context.services.auth, {
    superadmin: true,
  })
  const form = await request.formData()

  const name = String(form.get("name") ?? "").trim()
  const app = String(form.get("app") ?? "").trim()
  const redirectUris = parseUriList(String(form.get("redirectUris") ?? ""))

  if (!name || !app) return { error: "Name and app key are required.", field: !name ? "name" : "app" }
  if (redirectUris.length === 0)
    return { error: "Add at least one redirect URI.", field: "redirectUris" }
  const invalid = firstInvalidRedirectUri(redirectUris)
  if (invalid)
    return { error: `"${invalid}" isn't a valid URL. Use an absolute URL like https://app.example.com/callback.`, field: "redirectUris" }

  // The signed-in superadmin becomes the app's first admin (the service default).
  const created = await createApplication(context, caller, { name, app, redirectUris })
  if ("error" in created) {
    if (created.error === "app_taken")
      return { error: `The app key "${app}" is already taken.`, field: "app" }
    if (created.error === "invalid_redirect_uri")
      return { error: "Add at least one valid redirect URI.", field: "redirectUris" }
    return { error: "App keys are lowercase letters, numbers and dashes.", field: "app" }
  }
  return { created }
}

export default function AdminApplications({ loaderData }: Route.ComponentProps) {
  const { applications } = loaderData
  const actionData = useActionData<typeof action>()
  const nav = useNavigation()
  const busy = nav.state !== "idle"
  const created = actionData && "created" in actionData ? actionData.created : null
  const error = actionData && "error" in actionData ? actionData.error : null
  const field = actionData && "field" in actionData ? actionData.field : null
  const uriRef = useRef<HTMLInputElement>(null)
  // null = automatic: open when there's nothing to list, or when a submit
  // produced something to show (validation error, one-time secret).
  const [formOpen, setFormOpen] = useState<boolean | null>(null)
  const showForm = formOpen ?? (!!actionData || applications.length === 0)

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold tracking-tight">Applications</h1>
        <Button
          variant="outline"
          aria-expanded={showForm}
          aria-controls="register-application"
          onClick={() => setFormOpen(!showForm)}
        >
          <Plus className="size-4" />
          Register application
        </Button>
      </div>

      {showForm ? (
      <Card id="register-application">
        <CardHeader>
          <CardTitle>Register an application</CardTitle>
        </CardHeader>
        <CardContent>
          <Form method="post" className="flex flex-col gap-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="name">Name</Label>
                <Input id="name" name="name" placeholder="Invoices" required disabled={busy} />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="app">
                  App key <span className="text-muted-foreground font-normal">(stable, e.g. invoices)</span>
                </Label>
                <Input id="app" name="app" placeholder="invoices" required disabled={busy} />
              </div>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="redirectUris">Redirect URIs</Label>
              <Input
                id="redirectUris"
                name="redirectUris"
                ref={uriRef}
                placeholder="https://invoices.example.com/api/auth/oauth2/callback/willyim"
                aria-invalid={field === "redirectUris"}
                aria-describedby="redirectUris-help"
                required
                disabled={busy}
              />
              <p id="redirectUris-help" className="text-muted-foreground text-xs">
                Absolute URLs, space- or comma-separated.
              </p>
            </div>
            <Button type="submit" disabled={busy} className="self-start">
              {busy ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
              Register
            </Button>
          </Form>

          {error ? (
            <p role="alert" className="text-destructive mt-3 text-sm">
              {error}
            </p>
          ) : null}
          {created ? (
            <div role="status" className="bg-muted mt-4 rounded-md p-3 text-sm">
              <p className="font-medium">
                Application created — copy the secret now, it won't be shown again.
              </p>
              <dl className="mt-2 font-mono text-xs break-all">
                <div>
                  <dt className="inline">client_id:</dt>{" "}
                  <dd className="inline">{created.clientId}</dd>
                </div>
                <div>
                  <dt className="inline">client_secret:</dt>{" "}
                  <dd className="inline">{created.clientSecret}</dd>
                </div>
              </dl>
            </div>
          ) : null}
        </CardContent>
      </Card>
      ) : null}

      {applications.length === 0 ? (
        <p className="text-muted-foreground rounded-lg border border-dashed p-10 text-center text-sm">
          No applications yet.
        </p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>App key</TableHead>
              <TableHead>Client ID</TableHead>
              <TableHead>Redirects</TableHead>
              <TableHead className="w-8" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {applications.map((a) => (
              <TableRow key={a.clientId} className="relative">
                <TableCell className="font-medium">
                  {/* Stretched link: the whole row is clickable with real link semantics. */}
                  <Link
                    to={`/apps/${a.clientId}`}
                    className="no-underline after:absolute after:inset-0"
                  >
                    {a.name ?? "—"}
                  </Link>
                </TableCell>
                <TableCell>
                  {a.app ? <Badge variant="secondary">{a.app}</Badge> : "—"}
                </TableCell>
                <TableCell className="font-mono text-xs">{a.clientId}</TableCell>
                <TableCell className="text-muted-foreground">{a.redirectUris.length}</TableCell>
                <TableCell>
                  <ChevronRight className="text-muted-foreground size-4" />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  )
}
