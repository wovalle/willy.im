import { useState } from "react"
import { Form, Link, redirect, useActionData, useNavigation, useSearchParams, useSubmit } from "react-router"
import {
  Check,
  Copy,
  KeyRound,
  Loader2,
  Mail,
  Plus,
  ScrollText,
  ShieldCheck,
  Terminal,
  Trash2,
  UserCog,
  Users,
  X,
} from "lucide-react"

import type { Route } from "./+types/app-detail"
import {
  createWorkspaceForApp,
  deleteApplication,
  getApplication,
  impersonateAppMember,
  listAppMembers,
  listPeopleForApp,
  listWorkspacesForApp,
  rotateApplicationSecret,
  updateApplicationMetadata,
  updateApplicationPermissions,
  updateApplicationRedirectUris,
} from "~/lib/admin.server"
import { appConfigSchema } from "~/lib/metadata"
import {
  addOrInviteAppMember,
  listAppInvitations,
  removeAppMember,
  resendInvitation,
  revokeInvitation,
  updateAppMember,
} from "~/lib/members.server"
import { createApiKey, listApiKeys, revokeApiKey } from "~/lib/api-keys.server"
import { listAuditForApp } from "~/lib/audit.server"
import { requireConsoleCaller } from "~/lib/caller.server"
import { APP_PERMISSIONS, type AppPermission, type AppRole } from "~/lib/permissions"
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
import { cn } from "~/lib/utils"
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
  // The gate is app-scoped, so the app has to be resolved before it can be
  // applied: any member holding app:read may open this page, not just IdP
  // superadmins.
  const application = await getApplication(context, params.clientId)
  if (!application) throw new Response("Application not found", { status: 404 })
  const app = application.app ?? ""
  const caller = await requireConsoleCaller(request, context, context.services.auth, {
    app,
    permission: "app:read",
  })
  // What this caller may actually do here — the UI decides what to render, and
  // the loader decides what it can even ask for.
  const permissions = await caller.permissionsFor(app)
  const may = (permission: AppPermission) => permissions.includes(permission)
  const [workspaces, people, members, invitations, apiKeys, audit] = await Promise.all([
    app ? listWorkspacesForApp(context, app) : Promise.resolve([]),
    app ? listPeopleForApp(context, app) : Promise.resolve([]),
    app ? listAppMembers(context, app) : Promise.resolve([]),
    app ? listAppInvitations(context, app) : Promise.resolve([]),
    // Gated in the service: asking without apikey:read would 403 the page for a
    // member who is otherwise perfectly entitled to read it.
    app && may("apikey:read") ? listApiKeys(context, caller, app) : Promise.resolve([]),
    app ? listAuditForApp(context, app, 20) : Promise.resolve([]),
  ])
  return {
    application,
    workspaces,
    people,
    members,
    invitations,
    apiKeys,
    audit,
    permissions,
    // Impersonation needs superadmin *and* the permission (see admin.server), and
    // the button should be honest about both.
    isSuperadmin: caller.kind === "superadmin",
  }
}

export async function action({ request, context, params }: Route.ActionArgs) {
  // Authenticate only — every intent below is gated (and audited) by the service
  // it calls, so the console and the management API can't drift apart.
  const caller = await requireConsoleCaller(request, context, context.services.auth)
  const auth = context.services.auth
  const clientId = params.clientId
  const form = await request.formData()
  const intent = form.get("intent")

  if (intent === "delete") {
    await deleteApplication(context, caller, clientId)
    return redirect("/")
  }

  if (intent === "rotate") {
    const { clientSecret } = await rotateApplicationSecret(context, caller, clientId)
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
    await updateApplicationRedirectUris(context, caller, clientId, redirectUris)
    return { ok: "redirects" }
  }

  if (intent === "impersonate") {
    const application = await getApplication(context, clientId)
    const app = application?.app
    if (!app) return { error: "This application has no app key yet." }
    const res = await impersonateAppMember(context, caller, {
      app,
      userId: String(form.get("userId") ?? ""),
      auth,
      headers: request.headers,
    })
    if ("error" in res) return { error: res.error }
    const headers = new Headers()
    for (const cookie of res.setCookies) headers.append("set-cookie", cookie)
    // Land on the impersonated user's account; a banner offers "stop".
    return redirect("/account", { headers })
  }

  if (intent === "create-api-key" || intent === "revoke-api-key") {
    const application = await getApplication(context, clientId)
    const app = application?.app
    if (!app) return { error: "This application has no app key yet." }

    if (intent === "create-api-key") {
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
      const created = await createApiKey(context, caller, { app, name, permissions, expiresAt })
      if ("error" in created)
        return {
          error: `You can't grant permissions you don't hold: ${created.detail.join(", ")}.`,
          field: "key-name",
        }
      return { createdApiKey: { token: created.token, prefix: created.prefix, name } }
    }

    // revoke-api-key
    const keyId = String(form.get("keyId") ?? "")
    const res = await revokeApiKey(context, caller, { app, id: keyId })
    if ("error" in res) return { error: res.error }
    return { ok: "api-key-revoked" }
  }

  if (intent === "create-workspace") {
    const name = String(form.get("name") ?? "").trim()
    const slug = String(form.get("slug") ?? "").trim()
    const app = String(form.get("app") ?? "").trim()
    if (!name || !slug) return { error: "Workspace name and slug are required.", field: "ws-name" }
    const res = await createWorkspaceForApp(context, caller, { app, name, slug })
    if ("error" in res) return { error: res.error, field: "ws-name" }
    return { ok: "workspace" }
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

    const catalog = application?.permissions ?? []
    const readRole = (v: FormDataEntryValue | null): AppRole =>
      String(v) === "admin" ? "admin" : "member"
    const readPermissions = () =>
      form.getAll("permissions").map(String).filter(Boolean)
    const readProductPermissions = () =>
      form.getAll("productPermissions").map(String).filter(Boolean)

    if (intent === "invite-member") {
      const email = String(form.get("email") ?? "").trim()
      if (!email || !email.includes("@"))
        return { error: "Enter a valid email address.", field: "invite-email" }
      const result = await addOrInviteAppMember(context, caller, {
        app,
        email,
        role: readRole(form.get("role")),
        permissions: readPermissions(),
        productPermissions: readProductPermissions(),
        catalog,
        origin,
      })
      if (result.kind === "already-member")
        return { error: `${email} is already a member.`, field: "invite-email" }
      return { ok: result.kind === "added" ? "member-added" : "member-invited" }
    }

    if (intent === "update-member") {
      const res = await updateAppMember(context, caller, {
        app,
        userId: String(form.get("userId") ?? ""),
        role: readRole(form.get("role")),
        permissions: readPermissions(),
        productPermissions: readProductPermissions(),
        catalog,
      })
      if ("error" in res) return { error: res.error }
      return { ok: "member-updated" }
    }

    if (intent === "remove-member") {
      const res = await removeAppMember(context, caller, {
        app,
        userId: String(form.get("userId") ?? ""),
      })
      if ("error" in res) return { error: res.error }
      return { ok: "member-removed" }
    }

    if (intent === "revoke-invite") {
      await revokeInvitation(context, caller, {
        app,
        invitationId: String(form.get("invitationId") ?? ""),
      })
      return { ok: "invite-revoked" }
    }

    if (intent === "resend-invite") {
      const res = await resendInvitation(context, caller, {
        app,
        invitationId: String(form.get("invitationId") ?? ""),
        origin,
      })
      return "error" in res ? { error: res.error } : { ok: "invite-resent" }
    }
  }

  if (intent === "update-app-metadata") {
    const application = await getApplication(context, clientId)
    const app = application?.app
    if (!app) return { error: "This application has no app key yet." }
    // The permission catalog is managed in its own section; preserve it here so
    // toggling signup never touches it.
    const parsed = appConfigSchema.safeParse({
      allow_signup: form.get("allow_signup") === "on",
      permissions: application.permissions,
    })
    if (!parsed.success) return { error: "Invalid app settings.", field: "app-metadata" }
    await updateApplicationMetadata(context, caller, clientId, parsed.data)
    return { ok: "app-metadata" }
  }

  if (intent === "add-permission" || intent === "remove-permission") {
    const application = await getApplication(context, clientId)
    const app = application?.app
    if (!app) return { error: "This application has no app key yet." }
    const catalog = application?.permissions ?? []

    if (intent === "add-permission") {
      const value = String(form.get("permission") ?? "").trim()
      if (!value) return { error: "Enter a permission.", field: "add-permission" }
      if (/\s/.test(value))
        return { error: "Permissions can't contain spaces.", field: "add-permission" }
      if (catalog.includes(value))
        return { error: `"${value}" is already declared.`, field: "add-permission" }
      await updateApplicationPermissions(context, caller, clientId, [...catalog, value])
      return { ok: "permission-added" }
    }

    // remove-permission
    const value = String(form.get("permission") ?? "")
    await updateApplicationPermissions(
      context,
      caller,
      clientId,
      catalog.filter((p) => p !== value),
    )
    return { ok: "permission-removed" }
  }

  return { error: "Unknown action" }
}

export default function AppDetail({ loaderData }: Route.ComponentProps) {
  const { application, workspaces, people, members, invitations, apiKeys, audit, permissions } =
    loaderData
  const catalog = application.permissions
  // Controls whose intent this caller can't perform are hidden, not disabled: a
  // button that always 403s is a worse lie than no button at all. Read-only
  // content (the lists) still renders for anyone who got past app:read.
  const can = (permission: AppPermission) => permissions.includes(permission)
  const canManageMembers = can("member:manage")
  // Impersonation is superadmin-only regardless of the grant — mirror the
  // service's rule so the button never promises what the action refuses.
  const canImpersonate = can("user:impersonate") && loaderData.isSuperadmin
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

  const [searchParams] = useSearchParams()
  // Section lives in the URL so it survives Form posts (the action returns to the
  // same URL, search params and all) and is deep-linkable.
  const rawSection = searchParams.get("section") ?? "overview"
  const section = LEGACY_SECTIONS[rawSection] ?? rawSection

  const adminCount = members.filter((m) => m.role === "admin").length

  return (
    <div className="flex flex-col gap-6">
      {/* Breadcrumb-as-title: the back link is the trail, the leaf is the h1. */}
      <div className="flex items-baseline gap-1.5">
        <Link
          to="/"
          className="text-muted-foreground hover:text-foreground text-xl font-semibold tracking-tight no-underline transition-colors"
        >
          Applications
        </Link>
        <span className="text-muted-foreground text-xl font-semibold">/</span>
        <h1 className="text-xl font-semibold tracking-tight">
          {application.name ?? application.clientId}
        </h1>
      </div>

      <SectionTabs active={section} pendingInvites={invitations.length} />

      {section === "overview" ? (
      /* OAuth configuration + app settings — the app's identity and config */
      <Card>
        <CardHeader>
          <CardTitle>OAuth configuration</CardTitle>
          <CardDescription>Credentials and redirect URIs for the OIDC flow.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex min-w-0 flex-col gap-1.5">
              <Label>Client ID</Label>
              <div className="flex items-center gap-1">
                <code className="bg-muted min-w-0 flex-1 truncate rounded-md px-3 py-2 font-mono text-xs">
                  {application.clientId}
                </code>
                <CopyButton value={application.clientId} label="Copy client ID" />
              </div>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>App key</Label>
              <div>
                {application.app ? (
                  <Badge variant="secondary">{application.app}</Badge>
                ) : (
                  <span className="text-muted-foreground text-sm">Not set</span>
                )}
              </div>
            </div>
          </div>

          {can("app:update") ? (
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
          ) : (
            <div className="flex flex-col gap-1.5">
              <Label>Redirect URIs</Label>
              <code className="bg-muted rounded-md px-3 py-2 font-mono text-xs whitespace-pre-wrap">
                {application.redirectUris.join("\n")}
              </code>
            </div>
          )}

          {can("app:update") ? (
          <div className="flex flex-col gap-2 border-t pt-4">
            <Label>Client secret</Label>
            <p className="text-muted-foreground text-xs">
              Hashed and unrecoverable. Rotating invalidates the old secret immediately.
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
          ) : null}

          {can("app:update") ? (
          <Form method="post" className="flex flex-col gap-2 border-t pt-4">
            <input type="hidden" name="intent" value="update-app-metadata" />
            <Label>Signup</Label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                name="allow_signup"
                defaultChecked={application.allowSignup}
                disabled={busy}
                className="size-4"
              />
              Allow open signup (otherwise invite-only)
            </label>
            {field === "app-metadata" && error ? (
              <p role="alert" className="text-destructive text-sm">
                {error}
              </p>
            ) : null}
            <Button type="submit" variant="outline" disabled={busy} className="self-start">
              {busy ? <Loader2 className="size-4 animate-spin" /> : null}
              Save app settings
            </Button>
          </Form>
          ) : (
            <div className="flex flex-col gap-1.5 border-t pt-4">
              <Label>Signup</Label>
              <p className="text-muted-foreground text-sm">
                {application.allowSignup ? "Open signup is allowed." : "Invite-only."}
              </p>
            </div>
          )}
        </CardContent>
      </Card>
      ) : null}

      {section === "workspaces" ? (
      /* Workspaces */
      <Card>
        <CardHeader>
          <CardTitle>Workspaces</CardTitle>
          <CardDescription>Tenants of this application.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {can("workspace:create") ? (
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
          ) : null}
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
      ) : null}

      {section === "members" ? (
      /* App access — admins & members (IdP-level) */
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Users className="text-muted-foreground size-4" />
            Members
          </CardTitle>
          <CardDescription>
            Admins hold every permission; members hold a granted subset. Existing users are added
            immediately; new emails get an invitation.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-6">
          {can("member:invite") ? (
            <InviteMemberForm
              busy={busy}
              error={field === "invite-email" ? (error ?? null) : null}
              catalog={catalog}
            />
          ) : null}

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
                  {canManageMembers || canImpersonate ? (
                    <TableHead className="text-right">Actions</TableHead>
                  ) : null}
                </TableRow>
              </TableHeader>
              <TableBody>
                {members.map((m) => (
                  <MemberRow
                    key={m.userId}
                    member={m}
                    busy={busy}
                    catalog={catalog}
                    canManage={canManageMembers}
                    canImpersonate={canImpersonate}
                  />
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
                    {can("member:invite") ? (
                      <TableHead className="text-right">Actions</TableHead>
                    ) : null}
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
                      {can("member:invite") ? (
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
                      ) : null}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : null}
        </CardContent>
      </Card>
      ) : null}

      {section === "keys" ? (
      /* API keys — scoped management-API credentials */
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Terminal className="text-muted-foreground size-4" />
            API keys
          </CardTitle>
          <CardDescription>
            Scoped management-API credentials, bound to this app. The token is shown once at
            creation. Authenticate with{" "}
            <code className="font-mono text-xs">Authorization: Bearer &lt;token&gt;</code>.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-6">
          {can("apikey:create") ? (
            <CreateApiKeyForm
              busy={busy}
              error={field === "key-name" ? (error ?? null) : null}
              disabled={!application.app}
            />
          ) : null}

          {createdApiKey ? (
            <div className="bg-muted rounded-md p-3 text-sm">
              <p className="font-medium">
                Key “{createdApiKey.name}” created — copy it now, it won't be shown again.
              </p>
              <p className="mt-1 font-mono text-xs break-all">{createdApiKey.token}</p>
            </div>
          ) : null}

          {!can("apikey:read") ? (
            // The loader skips the query without apikey:read, so an empty list
            // here would read as "none exist" rather than "you can't see them".
            <p className="text-muted-foreground text-sm">
              You don't have permission to view this app's API keys.
            </p>
          ) : apiKeys.length === 0 ? (
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
                  {can("apikey:revoke") ? (
                    <TableHead className="text-right">Actions</TableHead>
                  ) : null}
                </TableRow>
              </TableHeader>
              <TableBody>
                {apiKeys.map((k) => (
                  <ApiKeyRow
                    key={k.id}
                    apiKey={k}
                    busy={busy}
                    canRevoke={can("apikey:revoke")}
                  />
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
      ) : null}

      {section === "members" ? (
      /* People (derived from workspace membership) */
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Users className="text-muted-foreground size-4" />
            People in workspaces
          </CardTitle>
          <CardDescription>Derived from workspace membership.</CardDescription>
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
      ) : null}

      {section === "activity" ? (
      /* Recent activity — audit trail */
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ScrollText className="text-muted-foreground size-4" />
            Recent activity
          </CardTitle>
          <CardDescription>Member, key and workspace writes, with actor.</CardDescription>
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
      ) : null}

      {section === "overview" && can("app:delete") ? (
      /* Danger zone */
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
      ) : null}

      {section === "access" ? (
        <PermissionsCatalog
          catalog={catalog}
          members={members}
          adminCount={adminCount}
          busy={busy}
          hasApp={!!application.app}
          canEdit={can("app:update")}
          addError={field === "add-permission" ? (error ?? null) : null}
        />
      ) : null}
    </div>
  )
}

const SECTIONS = [
  { id: "overview", label: "Overview" },
  { id: "members", label: "Members" },
  { id: "access", label: "Access" },
  { id: "workspaces", label: "Workspaces" },
  { id: "keys", label: "Keys" },
  { id: "activity", label: "Activity" },
] as const

/** Legacy `?section=` ids from the pre-rename console, mapped to their new homes. */
const LEGACY_SECTIONS: Record<string, string> = {
  config: "overview",
  permissions: "access",
  "api-keys": "keys",
}

/** Top-level section switcher. Reads and writes the URL `?section=` param. */
function SectionTabs({ active, pendingInvites }: { active: string; pendingInvites: number }) {
  return (
    <div className="border-foreground/10 -mt-2 border-b">
      <nav className="-mb-px flex gap-0.5 overflow-x-auto" aria-label="Sections">
        {SECTIONS.map((s) => {
          const isActive = active === s.id
          return (
            <Link
              key={s.id}
              to={`?section=${s.id}`}
              replace
              preventScrollReset
              aria-current={isActive ? "page" : undefined}
              className={cn(
                "flex items-center gap-1.5 border-b-2 px-3 py-2.5 text-sm font-medium whitespace-nowrap no-underline transition-colors",
                isActive
                  ? "border-foreground text-foreground"
                  : "text-muted-foreground hover:text-foreground border-transparent",
              )}
            >
              {s.label}
              {s.id === "members" && pendingInvites > 0 ? (
                <Badge variant="secondary" className="ml-0.5">
                  {pendingInvites}
                </Badge>
              ) : null}
            </Link>
          )
        })}
      </nav>
    </div>
  )
}

/**
 * First-class editor for the app's product-permission catalog. Each entry is the
 * vocabulary the app declares; members get a subset and granted permissions ride
 * in the id_token's permissions claim. Add/remove persist immediately.
 */
function PermissionsCatalog({
  catalog,
  members,
  adminCount,
  busy,
  hasApp,
  canEdit,
  addError,
}: {
  catalog: string[]
  members: Array<{ role: "admin" | "member"; productPermissions: string[] | null }>
  adminCount: number
  busy: boolean
  hasApp: boolean
  /** app:update — without it the catalog is readable but not editable. */
  canEdit: boolean
  addError: string | null
}) {
  const submit = useSubmit()
  // Admins implicitly hold the whole catalog; members hold what they're granted.
  const holdersFor = (p: string) =>
    adminCount +
    members.filter((m) => m.role === "member" && (m.productPermissions ?? []).includes(p)).length

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ShieldCheck className="text-muted-foreground size-4" />
          Product permissions
        </CardTitle>
        <CardDescription>
          The permission vocabulary this app declares. Grants ship in the id_token's{" "}
          <code className="font-mono text-xs">https://willy.im/permissions</code> claim; assign
          them in Members.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        {canEdit ? (
        <Form method="post" className="flex flex-wrap items-end gap-2">
          <input type="hidden" name="intent" value="add-permission" />
          <div className="flex flex-1 flex-col gap-1.5">
            <Label htmlFor="add-permission">Add a permission</Label>
            <Input
              id="add-permission"
              name="permission"
              placeholder="posts:write"
              required
              aria-invalid={!!addError}
              disabled={busy || !hasApp}
              className="font-mono"
            />
          </div>
          <Button type="submit" disabled={busy || !hasApp}>
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
            Add
          </Button>
        </Form>
        ) : null}
        {!hasApp ? (
          <p className="text-muted-foreground text-sm">
            This application has no app key yet, so it can't declare permissions.
          </p>
        ) : null}
        {addError ? (
          <p role="alert" className="text-destructive text-sm">
            {addError}
          </p>
        ) : null}

        {catalog.length === 0 ? (
          <div className="text-muted-foreground rounded-lg border border-dashed p-6 text-center text-sm">
            No permissions declared yet.
            {canEdit ? (
              <>
                {" "}
                Add one above — e.g. <code className="font-mono text-xs">posts:read</code>.
              </>
            ) : null}
          </div>
        ) : (
          <ul className="divide-border divide-y rounded-lg border">
            {catalog.map((p) => {
              const holders = holdersFor(p)
              return (
                <li key={p} className="flex items-center gap-3 px-3 py-2">
                  <code className="font-mono text-xs">{p}</code>
                  <Badge variant="secondary">
                    {holders} {holders === 1 ? "holder" : "holders"}
                  </Badge>
                  <div className="ml-auto">
                    {!canEdit ? null : holders > 0 ? (
                      <AlertDialog>
                        <AlertDialogTrigger
                          render={
                            <Button
                              variant="ghost"
                              size="sm"
                              className="text-destructive"
                              disabled={busy}
                              aria-label={`Remove ${p}`}
                            >
                              <X className="size-3.5" />
                            </Button>
                          }
                        />
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Remove “{p}”?</AlertDialogTitle>
                            <AlertDialogDescription>
                              {holders} {holders === 1 ? "principal currently holds" : "principals currently hold"}{" "}
                              this permission. Removing it from the catalog stops it being emitted in
                              the permissions claim for everyone. You can re-add it later.
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                            <AlertDialogAction
                              variant="destructive"
                              onClick={() =>
                                submit(
                                  { intent: "remove-permission", permission: p },
                                  { method: "post" },
                                )
                              }
                            >
                              Remove
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    ) : (
                      <Form method="post">
                        <input type="hidden" name="intent" value="remove-permission" />
                        <input type="hidden" name="permission" value={p} />
                        <Button
                          type="submit"
                          variant="ghost"
                          size="sm"
                          className="text-destructive"
                          disabled={busy}
                          aria-label={`Remove ${p}`}
                        >
                          <X className="size-3.5" />
                        </Button>
                      </Form>
                    )}
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}

/** Copy-to-clipboard icon button with a transient checkmark. */
function CopyButton({ value, label = "Copy" }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className="shrink-0"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value)
          setCopied(true)
          setTimeout(() => setCopied(false), 1500)
        } catch {
          // clipboard unavailable; no-op
        }
      }}
    >
      {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
      <span className="sr-only">{label}</span>
    </Button>
  )
}

const selectClass =
  "border-input bg-transparent focus-visible:ring-ring/50 h-8 rounded-md border px-2 text-sm shadow-xs focus-visible:ring-[3px] focus-visible:outline-none"

/** Checkboxes for a permission catalog. `name` is the form field the values post under. */
function PermissionPicker({
  name,
  options,
  selected,
  disabled,
}: {
  name: string
  options: readonly string[]
  selected: string[]
  disabled?: boolean
}) {
  if (options.length === 0)
    return <p className="text-muted-foreground text-xs">No permissions declared.</p>
  return (
    <fieldset className="grid grid-cols-2 gap-x-4 gap-y-1.5 sm:grid-cols-3">
      {options.map((p) => (
        <label key={p} className="flex items-center gap-2 text-xs">
          <input
            type="checkbox"
            name={name}
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
function InviteMemberForm({
  busy,
  error,
  catalog,
}: {
  busy: boolean
  error: string | null
  catalog: string[]
}) {
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
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label className="text-muted-foreground text-xs">IdP management permissions</Label>
            <PermissionPicker name="permissions" options={APP_PERMISSIONS} selected={[]} disabled={busy} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label className="text-muted-foreground text-xs">Product permissions</Label>
            <PermissionPicker name="productPermissions" options={catalog} selected={[]} disabled={busy} />
          </div>
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
  productPermissions: string[] | null
}

/** A member row, collapsible into an inline role + permission editor. */
function MemberRow({
  member,
  busy,
  catalog,
  canManage,
  canImpersonate,
}: {
  member: MemberRowData
  busy: boolean
  catalog: string[]
  canManage: boolean
  canImpersonate: boolean
}) {
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
                aria-label="Role"
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
              <div className="flex flex-col gap-3">
                <div className="flex flex-col gap-1.5">
                  <Label className="text-muted-foreground text-xs">IdP management permissions</Label>
                  <PermissionPicker
                    name="permissions"
                    options={APP_PERMISSIONS}
                    selected={member.permissions ?? []}
                    disabled={busy}
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label className="text-muted-foreground text-xs">Product permissions</Label>
                  <PermissionPicker
                    name="productPermissions"
                    options={catalog}
                    selected={member.productPermissions ?? []}
                    disabled={busy}
                  />
                </div>
              </div>
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
      {canManage || canImpersonate ? (
      <TableCell className="text-right whitespace-nowrap">
        {canManage ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={busy}
            onClick={() => setEditing(true)}
          >
            Edit
          </Button>
        ) : null}
        {canImpersonate ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={busy}
            onClick={() =>
              submit({ intent: "impersonate", userId: member.userId }, { method: "post" })
            }
          >
            <UserCog className="size-3.5" />
            Impersonate
            <span className="sr-only"> {member.email} (superadmin only)</span>
          </Button>
        ) : null}
        {canManage ? (
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
        ) : null}
      </TableCell>
      ) : null}
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
        <PermissionPicker
          name="permissions"
          options={APP_PERMISSIONS}
          selected={[]}
          disabled={busy || disabled}
        />
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
function ApiKeyRow({
  apiKey,
  busy,
  canRevoke,
}: {
  apiKey: ApiKeyRowData
  busy: boolean
  canRevoke: boolean
}) {
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
      {canRevoke ? (
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
      ) : null}
    </TableRow>
  )
}
