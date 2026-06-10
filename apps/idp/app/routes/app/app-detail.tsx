import { useState } from "react"
import { Form, Link, redirect, useActionData, useNavigation, useSubmit } from "react-router"
import { ChevronRight, KeyRound, Loader2, Mail, Plus, ScrollText, Terminal, Trash2, Users } from "lucide-react"

import type { Route } from "./+types/app-detail"
import {
  createWorkspace,
  deleteApplication,
  getApplication,
  listAppMembers,
  listPeopleForApp,
  listWorkspacesForApp,
  requireAdminSession,
  rotateApplicationSecret,
  updateApplicationRedirectUris,
} from "~/lib/admin.server"
import {
  addOrInviteAppMember,
  listAppInvitations,
  removeAppMember,
  resendInvitation,
  revokeInvitation,
  updateAppMember,
} from "~/lib/members.server"
import { createApiKey, listApiKeys, revokeApiKey } from "~/lib/api-keys.server"
import { actorFromUser, listAuditForApp, recordAudit } from "~/lib/audit.server"
import { APP_PERMISSIONS, type AppRole } from "~/lib/permissions"
import { requireAppPermission } from "~/lib/security.server"
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
  const [workspaces, people, members, invitations, apiKeys, audit] = await Promise.all([
    app ? listWorkspacesForApp(context, app) : Promise.resolve([]),
    app ? listPeopleForApp(context, app) : Promise.resolve([]),
    app ? listAppMembers(context, app) : Promise.resolve([]),
    app ? listAppInvitations(context, app) : Promise.resolve([]),
    app ? listApiKeys(context, app) : Promise.resolve([]),
    app ? listAuditForApp(context, app, 20) : Promise.resolve([]),
  ])
  return { application, workspaces, people, members, invitations, apiKeys, audit }
}

export async function action({ request, context, params }: Route.ActionArgs) {
  const session = await requireAdminSession(request, context, context.services.auth)
  const actor = actorFromUser(session.user)
  const auth = context.services.auth
  const clientId = params.clientId
  const form = await request.formData()
  const intent = form.get("intent")

  if (intent === "delete") {
    await deleteApplication(context, clientId)
    return redirect("/")
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

  if (intent === "create-api-key" || intent === "revoke-api-key") {
    const application = await getApplication(context, clientId)
    const app = application?.app
    if (!app) return { error: "This application has no app key yet." }

    if (intent === "create-api-key") {
      const access = await requireAppPermission(request, context, auth, app, "apikey:create")
      const name = String(form.get("name") ?? "").trim()
      if (!name) return { error: "Give the key a name.", field: "key-name" }
      const permissions = form.getAll("permissions").map(String).filter(Boolean)
      if (permissions.length === 0)
        return { error: "Select at least one permission.", field: "key-name" }
      const days = Number(form.get("expiresInDays"))
      const expiresAt =
        Number.isFinite(days) && days > 0
          ? new Date(Date.now() + days * 24 * 60 * 60 * 1000)
          : null
      const { id, token, prefix } = await createApiKey(context, {
        app,
        name,
        permissions,
        createdByUserId: access.user.id,
        expiresAt,
      })
      await recordAudit(context, {
        actor,
        table: "api_key",
        operation: "create",
        applicationId: app,
        rowId: id,
        after: { name, permissions, expiresAt: expiresAt?.toISOString() ?? null },
      })
      return { createdApiKey: { token, prefix, name } }
    }

    // revoke-api-key
    await requireAppPermission(request, context, auth, app, "apikey:revoke")
    const keyId = String(form.get("keyId") ?? "")
    const res = await revokeApiKey(context, { app, id: keyId })
    if ("error" in res) return { error: res.error }
    await recordAudit(context, {
      actor,
      table: "api_key",
      operation: "revoke",
      applicationId: app,
      rowId: keyId,
    })
    return { ok: "api-key-revoked" }
  }

  if (intent === "create-workspace") {
    const name = String(form.get("name") ?? "").trim()
    const slug = String(form.get("slug") ?? "").trim()
    const app = String(form.get("app") ?? "").trim()
    if (!name || !slug) return { error: "Workspace name and slug are required.", field: "ws-name" }
    try {
      await createWorkspace(request, auth, { name, slug, applicationId: app })
      await recordAudit(context, {
        actor,
        table: "organization",
        operation: "create",
        applicationId: app,
        after: { name, slug },
      })
      return { ok: "workspace" }
    } catch (e) {
      return { error: e instanceof Error ? e.message : "Couldn't create workspace.", field: "ws-name" }
    }
  }

  // Member-management intents. Resolved against the app's access catalog so
  // app-admins (not just superadmin) can manage their own app once the route
  // opens up; superadmin passes everything today.
  if (
    intent === "invite-member" ||
    intent === "update-member" ||
    intent === "remove-member" ||
    intent === "revoke-invite" ||
    intent === "resend-invite"
  ) {
    const application = await getApplication(context, clientId)
    const app = application?.app
    if (!app) return { error: "This application has no app key yet." }
    const origin = new URL(request.url).origin

    const readRole = (v: FormDataEntryValue | null): AppRole =>
      String(v) === "admin" ? "admin" : "member"
    const readPermissions = () =>
      form.getAll("permissions").map(String).filter(Boolean)

    if (intent === "invite-member") {
      const access = await requireAppPermission(request, context, auth, app, "member:invite")
      const email = String(form.get("email") ?? "").trim()
      if (!email || !email.includes("@"))
        return { error: "Enter a valid email address.", field: "invite-email" }
      const result = await addOrInviteAppMember(context, {
        app,
        email,
        role: readRole(form.get("role")),
        permissions: readPermissions(),
        invitedByUserId: access.user.id,
        origin,
      })
      if (result.kind === "already-member")
        return { error: `${email} is already a member.`, field: "invite-email" }
      await recordAudit(context, {
        actor,
        table: result.kind === "added" ? "application_member" : "application_invitation",
        operation: "invite",
        applicationId: app,
        after: { email, role: readRole(form.get("role")), result: result.kind },
      })
      return { ok: result.kind === "added" ? "member-added" : "member-invited" }
    }

    if (intent === "update-member") {
      await requireAppPermission(request, context, auth, app, "member:manage")
      const userId = String(form.get("userId") ?? "")
      const role = readRole(form.get("role"))
      const res = await updateAppMember(context, {
        app,
        userId,
        role,
        permissions: readPermissions(),
      })
      if ("error" in res) return { error: res.error }
      await recordAudit(context, {
        actor,
        table: "application_member",
        operation: "update",
        applicationId: app,
        rowId: userId,
        after: { role, permissions: readPermissions() },
      })
      return { ok: "member-updated" }
    }

    if (intent === "remove-member") {
      await requireAppPermission(request, context, auth, app, "member:manage")
      const userId = String(form.get("userId") ?? "")
      const res = await removeAppMember(context, { app, userId })
      if ("error" in res) return { error: res.error }
      await recordAudit(context, {
        actor,
        table: "application_member",
        operation: "delete",
        applicationId: app,
        rowId: userId,
      })
      return { ok: "member-removed" }
    }

    if (intent === "revoke-invite") {
      await requireAppPermission(request, context, auth, app, "member:invite")
      await revokeInvitation(context, { app, invitationId: String(form.get("invitationId") ?? "") })
      return { ok: "invite-revoked" }
    }

    if (intent === "resend-invite") {
      await requireAppPermission(request, context, auth, app, "member:invite")
      const res = await resendInvitation(context, {
        app,
        invitationId: String(form.get("invitationId") ?? ""),
        origin,
      })
      return "error" in res ? { error: res.error } : { ok: "invite-resent" }
    }
  }

  return { error: "Unknown action" }
}

export default function AppDetail({ loaderData }: Route.ComponentProps) {
  const { application, workspaces, people, members, invitations, apiKeys, audit } = loaderData
  const actionData = useActionData<typeof action>()
  const nav = useNavigation()
  const submit = useSubmit()
  const busy = nav.state !== "idle"
  const [confirmOpen, setConfirmOpen] = useState(false)

  const rotatedSecret =
    actionData && "rotatedSecret" in actionData ? actionData.rotatedSecret : null
  const createdApiKey =
    actionData && "createdApiKey" in actionData ? actionData.createdApiKey : null
  const error = actionData && "error" in actionData ? actionData.error : null
  const field = actionData && "field" in actionData ? actionData.field : null
  const memberError =
    error && (field === "invite-email" || field === undefined || field === null) ? error : null

  return (
    <div className="flex flex-col gap-6">
      {/* Breadcrumb */}
      <nav className="text-muted-foreground flex items-center gap-1.5 text-sm" aria-label="Breadcrumb">
        <Link to="/" className="hover:text-foreground no-underline">
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

      {/* App access — admins & members (IdP-level) */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Users className="text-muted-foreground size-4" />
            App access
          </CardTitle>
          <CardDescription>
            Admins manage this app in the IdP (all permissions); members get specific permissions.
            Inviting an existing willy.im user adds them right away; a new email gets an invitation.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-6">
          <InviteMemberForm busy={busy} error={field === "invite-email" ? (error ?? null) : null} />

          {memberError && field !== "invite-email" ? (
            <p role="alert" className="text-destructive text-sm">
              {memberError}
            </p>
          ) : null}

          {members.length === 0 ? (
            <p className="text-muted-foreground text-sm">No app admins or members yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Email</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Permissions</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {members.map((m) => (
                  <MemberRow key={m.userId} member={m} busy={busy} />
                ))}
              </TableBody>
            </Table>
          )}

          {invitations.length > 0 ? (
            <div className="flex flex-col gap-2">
              <h3 className="text-muted-foreground flex items-center gap-1.5 text-xs font-medium tracking-wide uppercase">
                <Mail className="size-3.5" />
                Pending invitations
              </h3>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Email</TableHead>
                    <TableHead>Role</TableHead>
                    <TableHead>Permissions</TableHead>
                    <TableHead>Expires</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {invitations.map((inv) => (
                    <TableRow key={inv.id}>
                      <TableCell>{inv.email}</TableCell>
                      <TableCell>
                        <Badge variant={inv.role === "admin" ? "default" : "secondary"}>
                          {inv.role}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-muted-foreground text-xs">
                        {inv.role === "admin" ? "all" : (inv.permissions ?? []).join(", ") || "—"}
                      </TableCell>
                      <TableCell className="text-muted-foreground text-xs">
                        {new Date(inv.expiresAt as unknown as string).toLocaleDateString()}
                      </TableCell>
                      <TableCell className="text-right whitespace-nowrap">
                        <Form method="post" className="inline">
                          <input type="hidden" name="intent" value="resend-invite" />
                          <input type="hidden" name="invitationId" value={inv.id} />
                          <Button type="submit" variant="ghost" size="sm" disabled={busy}>
                            Resend
                          </Button>
                        </Form>
                        <Form method="post" className="inline">
                          <input type="hidden" name="intent" value="revoke-invite" />
                          <input type="hidden" name="invitationId" value={inv.id} />
                          <Button
                            type="submit"
                            variant="ghost"
                            size="sm"
                            disabled={busy}
                            className="text-destructive"
                          >
                            Revoke
                          </Button>
                        </Form>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : null}
        </CardContent>
      </Card>

      {/* API keys — scoped management-API credentials */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Terminal className="text-muted-foreground size-4" />
            API keys
          </CardTitle>
          <CardDescription>
            Scoped credentials for the management API. A key carries a fixed set of permissions and
            can only act on this app. The token is shown once at creation — store it somewhere safe.
            Authenticate with <code className="font-mono text-xs">Authorization: Bearer &lt;token&gt;</code>.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-6">
          <CreateApiKeyForm
            busy={busy}
            error={field === "key-name" ? (error ?? null) : null}
            disabled={!application.app}
          />

          {createdApiKey ? (
            <div className="bg-muted rounded-md p-3 text-sm">
              <p className="font-medium">
                Key “{createdApiKey.name}” created — copy it now, it won't be shown again.
              </p>
              <p className="mt-1 font-mono text-xs break-all">{createdApiKey.token}</p>
            </div>
          ) : null}

          {apiKeys.length === 0 ? (
            <p className="text-muted-foreground text-sm">No API keys yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Prefix</TableHead>
                  <TableHead>Permissions</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Last used</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {apiKeys.map((k) => (
                  <ApiKeyRow key={k.id} apiKey={k} busy={busy} />
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* People (derived from workspace membership) */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Users className="text-muted-foreground size-4" />
            People in workspaces
          </CardTitle>
          <CardDescription>
            Derived from workspace membership — these willy.im users belong to a workspace of this app.
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

      {/* Recent activity — audit trail */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ScrollText className="text-muted-foreground size-4" />
            Recent activity
          </CardTitle>
          <CardDescription>
            Privileged actions on this app — member, API key and workspace writes — with who did them.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {audit.length === 0 ? (
            <p className="text-muted-foreground text-sm">No activity yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>When</TableHead>
                  <TableHead>Action</TableHead>
                  <TableHead>Entity</TableHead>
                  <TableHead>Actor</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {audit.map((e) => (
                  <TableRow key={e.id}>
                    <TableCell className="text-muted-foreground text-xs whitespace-nowrap">
                      {new Date(`${e.createdAt.replace(" ", "T")}Z`).toLocaleString()}
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary">{e.operation}</Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground font-mono text-xs">
                      {e.tableName}
                      {e.rowId ? <span className="opacity-60"> · {e.rowId.slice(0, 8)}…</span> : null}
                    </TableCell>
                    <TableCell className="text-muted-foreground font-mono text-xs break-all">
                      {e.actor ?? "—"}
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

const selectClass =
  "border-input bg-transparent focus-visible:ring-ring/50 h-8 rounded-md border px-2 text-sm shadow-xs focus-visible:ring-[3px] focus-visible:outline-none"

/** Checkboxes for the IdP management permission catalog (members only). */
function PermissionPicker({
  selected,
  disabled,
}: {
  selected: string[]
  disabled?: boolean
}) {
  return (
    <fieldset className="grid grid-cols-2 gap-x-4 gap-y-1.5 sm:grid-cols-3">
      {APP_PERMISSIONS.map((p) => (
        <label key={p} className="flex items-center gap-2 text-xs">
          <input
            type="checkbox"
            name="permissions"
            value={p}
            defaultChecked={selected.includes(p)}
            disabled={disabled}
            className="size-3.5"
          />
          <span className="font-mono">{p}</span>
        </label>
      ))}
    </fieldset>
  )
}

/** Invite by email: existing user → added now; new email → invitation sent. */
function InviteMemberForm({ busy, error }: { busy: boolean; error: string | null }) {
  const [role, setRole] = useState<AppRole>("member")
  return (
    <Form method="post" className="flex flex-col gap-3 rounded-lg border p-4">
      <input type="hidden" name="intent" value="invite-member" />
      <div className="flex flex-wrap items-end gap-2">
        <div className="flex flex-1 flex-col gap-1.5">
          <Label htmlFor="invite-email">Email</Label>
          <Input
            id="invite-email"
            name="email"
            type="email"
            placeholder="friend@example.com"
            required
            aria-invalid={!!error}
            disabled={busy}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="invite-role">Role</Label>
          <select
            id="invite-role"
            name="role"
            value={role}
            onChange={(e) => setRole(e.target.value as AppRole)}
            disabled={busy}
            className={selectClass}
          >
            <option value="member">member</option>
            <option value="admin">admin</option>
          </select>
        </div>
        <Button type="submit" disabled={busy}>
          {busy ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
          Invite
        </Button>
      </div>
      {role === "member" ? (
        <div className="flex flex-col gap-1.5">
          <Label className="text-muted-foreground text-xs">Permissions</Label>
          <PermissionPicker selected={[]} disabled={busy} />
        </div>
      ) : (
        <p className="text-muted-foreground text-xs">Admins get all permissions.</p>
      )}
      {error ? (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      ) : null}
    </Form>
  )
}

type MemberRowData = {
  userId: string
  email: string
  name: string | null
  role: "admin" | "member"
  permissions: string[] | null
}

/** A member row, collapsible into an inline role + permission editor. */
function MemberRow({ member, busy }: { member: MemberRowData; busy: boolean }) {
  const submit = useSubmit()
  const [editing, setEditing] = useState(false)
  const [role, setRole] = useState<AppRole>(member.role)

  if (editing) {
    return (
      <TableRow>
        <TableCell colSpan={4}>
          <Form
            method="post"
            className="flex flex-col gap-3 py-1"
            onSubmit={() => setEditing(false)}
          >
            <input type="hidden" name="intent" value="update-member" />
            <input type="hidden" name="userId" value={member.userId} />
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-medium">{member.email}</span>
              <select
                name="role"
                value={role}
                onChange={(e) => setRole(e.target.value as AppRole)}
                disabled={busy}
                className={selectClass}
              >
                <option value="member">member</option>
                <option value="admin">admin</option>
              </select>
            </div>
            {role === "member" ? (
              <PermissionPicker selected={member.permissions ?? []} disabled={busy} />
            ) : (
              <p className="text-muted-foreground text-xs">Admins get all permissions.</p>
            )}
            <div className="flex gap-2">
              <Button type="submit" size="sm" disabled={busy}>
                Save
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                disabled={busy}
                onClick={() => {
                  setRole(member.role)
                  setEditing(false)
                }}
              >
                Cancel
              </Button>
            </div>
          </Form>
        </TableCell>
      </TableRow>
    )
  }

  return (
    <TableRow>
      <TableCell>{member.email}</TableCell>
      <TableCell>
        <Badge variant={member.role === "admin" ? "default" : "secondary"}>{member.role}</Badge>
      </TableCell>
      <TableCell className="text-muted-foreground text-xs">
        {member.role === "admin" ? "all" : (member.permissions ?? []).join(", ") || "—"}
      </TableCell>
      <TableCell className="text-right whitespace-nowrap">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={busy}
          onClick={() => setEditing(true)}
        >
          Edit
        </Button>
        <AlertDialog>
          <AlertDialogTrigger
            render={
              <Button variant="ghost" size="sm" className="text-destructive" disabled={busy}>
                <Trash2 className="size-3.5" />
                Remove
              </Button>
            }
          />
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Remove {member.email}?</AlertDialogTitle>
              <AlertDialogDescription>
                They lose access to this app in the IdP. You can re-invite them later.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                variant="destructive"
                onClick={() =>
                  submit(
                    { intent: "remove-member", userId: member.userId },
                    { method: "post" },
                  )
                }
              >
                Remove
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </TableCell>
    </TableRow>
  )
}

/** Mint a scoped API key: name + permission set + optional expiry. */
function CreateApiKeyForm({
  busy,
  error,
  disabled,
}: {
  busy: boolean
  error: string | null
  disabled: boolean
}) {
  return (
    <Form method="post" className="flex flex-col gap-3 rounded-lg border p-4">
      <input type="hidden" name="intent" value="create-api-key" />
      <div className="flex flex-wrap items-end gap-2">
        <div className="flex flex-1 flex-col gap-1.5">
          <Label htmlFor="key-name">Name</Label>
          <Input
            id="key-name"
            name="name"
            placeholder="kasso ingestion agent"
            required
            aria-invalid={!!error}
            disabled={busy || disabled}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="key-expiry">Expires</Label>
          <select id="key-expiry" name="expiresInDays" disabled={busy || disabled} className={selectClass}>
            <option value="0">Never</option>
            <option value="30">30 days</option>
            <option value="90">90 days</option>
            <option value="365">1 year</option>
          </select>
        </div>
        <Button type="submit" disabled={busy || disabled}>
          {busy ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
          Create key
        </Button>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label className="text-muted-foreground text-xs">Permissions</Label>
        <PermissionPicker selected={[]} disabled={busy || disabled} />
      </div>
      {error ? (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      ) : null}
    </Form>
  )
}

type ApiKeyRowData = {
  id: string
  name: string
  prefix: string
  permissions: string[]
  status: "active" | "expired" | "revoked"
  lastUsedAt: string | Date | null
  expiresAt: string | Date | null
}

const statusVariant: Record<ApiKeyRowData["status"], "default" | "secondary" | "outline"> = {
  active: "default",
  expired: "outline",
  revoked: "secondary",
}

/** A single API key row with an inline revoke confirmation. */
function ApiKeyRow({ apiKey, busy }: { apiKey: ApiKeyRowData; busy: boolean }) {
  const submit = useSubmit()
  const fmtDate = (d: string | Date | null) =>
    d ? new Date(d as string).toLocaleDateString() : "—"
  return (
    <TableRow>
      <TableCell className="font-medium">{apiKey.name}</TableCell>
      <TableCell>
        <code className="font-mono text-xs">{apiKey.prefix}…</code>
      </TableCell>
      <TableCell className="text-muted-foreground max-w-[16rem] text-xs">
        {apiKey.permissions.join(", ") || "—"}
      </TableCell>
      <TableCell>
        <Badge variant={statusVariant[apiKey.status]}>{apiKey.status}</Badge>
      </TableCell>
      <TableCell className="text-muted-foreground text-xs">{fmtDate(apiKey.lastUsedAt)}</TableCell>
      <TableCell className="text-right whitespace-nowrap">
        {apiKey.status === "revoked" ? (
          <span className="text-muted-foreground text-xs">—</span>
        ) : (
          <AlertDialog>
            <AlertDialogTrigger
              render={
                <Button variant="ghost" size="sm" className="text-destructive" disabled={busy}>
                  <Trash2 className="size-3.5" />
                  Revoke
                </Button>
              }
            />
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Revoke “{apiKey.name}”?</AlertDialogTitle>
                <AlertDialogDescription>
                  The key stops working immediately. Any agent using it will start getting 401s.
                  This can't be undone.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  variant="destructive"
                  onClick={() =>
                    submit({ intent: "revoke-api-key", keyId: apiKey.id }, { method: "post" })
                  }
                >
                  Revoke
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        )}
      </TableCell>
    </TableRow>
  )
}
