import { useState } from "react"
import { Form, Link, redirect, useActionData, useNavigation, useSubmit } from "react-router"
import { ChevronRight, KeyRound, Loader2, Plus, Users } from "lucide-react"

import type { Route } from "./+types/app-detail"
import {
  createWorkspace,
  deleteApplication,
  getApplication,
  listPeopleForApp,
  listWorkspacesForApp,
  requireAdminSession,
  rotateApplicationSecret,
  updateApplicationRedirectUris,
} from "~/lib/admin.server"
import { firstInvalidRedirectUri, parseUriList } from "~/lib/validate"
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

export async function loader({ request, context, params }: Route.LoaderArgs) {
  await requireAdminSession(request, context, context.services.auth)
  const application = await getApplication(context, params.clientId)
  if (!application) throw new Response("Application not found", { status: 404 })
  const app = application.app ?? ""
  const [workspaces, people] = await Promise.all([
    app ? listWorkspacesForApp(context, app) : Promise.resolve([]),
    app ? listPeopleForApp(context, app) : Promise.resolve([]),
  ])
  return { application, workspaces, people }
}

export async function action({ request, context, params }: Route.ActionArgs) {
  await requireAdminSession(request, context, context.services.auth)
  const auth = context.services.auth
  const clientId = params.clientId
  const form = await request.formData()
  const intent = form.get("intent")

  if (intent === "delete") {
    await deleteApplication(context, clientId)
    return redirect("/admin")
  }

  if (intent === "rotate") {
    const { clientSecret } = await rotateApplicationSecret(request, auth, clientId)
    return { rotatedSecret: clientSecret }
  }

  if (intent === "update-redirects") {
    const redirectUris = parseUriList(String(form.get("redirectUris") ?? ""))
    if (redirectUris.length === 0)
      return { error: "Add at least one redirect URI.", field: "redirectUris" }
    const invalid = firstInvalidRedirectUri(redirectUris)
    if (invalid)
      return {
        error: `"${invalid}" isn't a valid URL. Use an absolute URL like https://app.example.com/callback.`,
        field: "redirectUris",
      }
    await updateApplicationRedirectUris(request, auth, clientId, redirectUris)
    return { ok: "redirects" }
  }

  if (intent === "create-workspace") {
    const name = String(form.get("name") ?? "").trim()
    const slug = String(form.get("slug") ?? "").trim()
    const app = String(form.get("app") ?? "").trim()
    if (!name || !slug) return { error: "Workspace name and slug are required.", field: "ws-name" }
    try {
      await createWorkspace(request, auth, { name, slug, applicationId: app })
      return { ok: "workspace" }
    } catch (e) {
      return { error: e instanceof Error ? e.message : "Couldn't create workspace.", field: "ws-name" }
    }
  }

  return { error: "Unknown action" }
}

export default function AppDetail({ loaderData }: Route.ComponentProps) {
  const { application, workspaces, people } = loaderData
  const actionData = useActionData<typeof action>()
  const nav = useNavigation()
  const submit = useSubmit()
  const busy = nav.state !== "idle"
  const [confirmOpen, setConfirmOpen] = useState(false)

  const rotatedSecret =
    actionData && "rotatedSecret" in actionData ? actionData.rotatedSecret : null
  const error = actionData && "error" in actionData ? actionData.error : null
  const field = actionData && "field" in actionData ? actionData.field : null

  return (
    <div className="flex flex-col gap-6">
      {/* Breadcrumb */}
      <nav className="text-muted-foreground flex items-center gap-1.5 text-sm" aria-label="Breadcrumb">
        <Link to="/admin" className="hover:text-foreground no-underline">
          Applications
        </Link>
        <ChevronRight className="size-3.5" />
        <span className="text-foreground">{application.name ?? application.clientId}</span>
      </nav>

      <div className="flex items-center gap-3">
        <h1 className="text-xl font-semibold tracking-tight">
          {application.name ?? "Untitled app"}
        </h1>
        {application.app ? <Badge variant="secondary">{application.app}</Badge> : null}
      </div>

      {/* OAuth configuration */}
      <Card>
        <CardHeader>
          <CardTitle>OAuth configuration</CardTitle>
          <CardDescription>Credentials and redirect URIs for the OIDC flow.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          <div className="flex flex-col gap-1.5">
            <Label>Client ID</Label>
            <code className="bg-muted rounded-md px-3 py-2 font-mono text-xs break-all">
              {application.clientId}
            </code>
          </div>

          <Form method="post" className="flex flex-col gap-2">
            <input type="hidden" name="intent" value="update-redirects" />
            <Label htmlFor="redirectUris">Redirect URIs</Label>
            <textarea
              id="redirectUris"
              name="redirectUris"
              rows={3}
              defaultValue={application.redirectUris.join("\n")}
              aria-invalid={field === "redirectUris"}
              className="border-input bg-transparent placeholder:text-muted-foreground focus-visible:ring-ring/50 aria-invalid:border-destructive min-h-16 w-full rounded-md border px-3 py-2 font-mono text-xs shadow-xs focus-visible:ring-[3px] focus-visible:outline-none"
              disabled={busy}
            />
            <p className="text-muted-foreground text-xs">One per line. Absolute URLs only.</p>
            {field === "redirectUris" && error ? (
              <p role="alert" className="text-destructive text-sm">
                {error}
              </p>
            ) : null}
            <Button type="submit" variant="outline" disabled={busy} className="self-start">
              {busy ? <Loader2 className="size-4 animate-spin" /> : null}
              Save redirect URIs
            </Button>
          </Form>

          <div className="flex flex-col gap-2 border-t pt-4">
            <Label>Client secret</Label>
            <p className="text-muted-foreground text-xs">
              Hashed and unrecoverable. Rotate to issue a new one — the old secret stops working
              immediately.
            </p>
            <Form method="post">
              <input type="hidden" name="intent" value="rotate" />
              <Button type="submit" variant="outline" disabled={busy} className="self-start">
                {busy ? <Loader2 className="size-4 animate-spin" /> : <KeyRound className="size-4" />}
                Rotate secret
              </Button>
            </Form>
            {rotatedSecret ? (
              <div className="bg-muted mt-1 rounded-md p-3 text-sm">
                <p className="font-medium">New secret — copy it now, it won't be shown again.</p>
                <p className="mt-1 font-mono text-xs break-all">client_secret: {rotatedSecret}</p>
              </div>
            ) : null}
          </div>
        </CardContent>
      </Card>

      {/* Workspaces */}
      <Card>
        <CardHeader>
          <CardTitle>Workspaces</CardTitle>
          <CardDescription>Tenants of this application. Members get a role here.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <Form method="post" className="flex flex-wrap items-end gap-2">
            <input type="hidden" name="intent" value="create-workspace" />
            <input type="hidden" name="app" value={application.app ?? ""} />
            <div className="flex flex-1 flex-col gap-1.5">
              <Label htmlFor="ws-name">Name</Label>
              <Input id="ws-name" name="name" placeholder="Acme Corp" required disabled={busy} />
            </div>
            <div className="flex flex-1 flex-col gap-1.5">
              <Label htmlFor="ws-slug">Slug</Label>
              <Input id="ws-slug" name="slug" placeholder="acme" required disabled={busy} />
            </div>
            <Button type="submit" disabled={busy || !application.app}>
              {busy ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
              Add
            </Button>
          </Form>
          {field === "ws-name" && error ? (
            <p role="alert" className="text-destructive text-sm">
              {error}
            </p>
          ) : null}

          {workspaces.length === 0 ? (
            <p className="text-muted-foreground text-sm">No workspaces yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Slug</TableHead>
                  <TableHead>Created</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {workspaces.map((w) => (
                  <TableRow key={w.id}>
                    <TableCell className="font-medium">{w.name}</TableCell>
                    <TableCell className="text-muted-foreground">{w.slug}</TableCell>
                    <TableCell className="text-muted-foreground text-xs">
                      {new Date(w.createdAt as unknown as string).toLocaleDateString()}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* People (derived) */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Users className="text-muted-foreground size-4" />
            People with access
          </CardTitle>
          <CardDescription>
            Derived from workspace membership — these willy.im users can sign in to this app.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {people.length === 0 ? (
            <p className="text-muted-foreground text-sm">No members yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Email</TableHead>
                  <TableHead>Workspace</TableHead>
                  <TableHead>Role</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {people.map((p, i) => (
                  <TableRow key={`${p.email}-${p.workspace}-${i}`}>
                    <TableCell>{p.email}</TableCell>
                    <TableCell className="text-muted-foreground">{p.workspace}</TableCell>
                    <TableCell>
                      <Badge variant="secondary">{p.role}</Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Danger zone */}
      <Card className="border-destructive/40">
        <CardHeader>
          <CardTitle className="text-destructive">Danger zone</CardTitle>
          <CardDescription>Deleting an application immediately breaks its sign-in.</CardDescription>
        </CardHeader>
        <CardContent>
          <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
            <AlertDialogTrigger render={<Button variant="destructive">Delete application</Button>} />
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete {application.name ?? "this application"}?</AlertDialogTitle>
                <AlertDialogDescription>
                  This permanently removes the OAuth client. Any app using it will fail to sign in.
                  This can't be undone.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  variant="destructive"
                  onClick={() => {
                    setConfirmOpen(false)
                    submit({ intent: "delete" }, { method: "post" })
                  }}
                >
                  Delete
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </CardContent>
      </Card>
    </div>
  )
}
