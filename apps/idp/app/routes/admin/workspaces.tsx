import { Form, useActionData, useNavigation } from "react-router"
import { Loader2 } from "lucide-react"

import type { Route } from "./+types/workspaces"
import { createWorkspace, listWorkspaces, requireAdminSession } from "~/lib/admin.server"
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
  return { workspaces: await listWorkspaces(context) }
}

export async function action({ request, context }: Route.ActionArgs) {
  await requireAdminSession(request, context, context.services.auth)
  const form = await request.formData()
  const name = String(form.get("name") ?? "").trim()
  const slug = String(form.get("slug") ?? "").trim()
  const applicationId = String(form.get("applicationId") ?? "").trim()
  if (!name || !slug || !applicationId) {
    return { error: "Name, slug and app key are required." }
  }
  try {
    await createWorkspace(request, context.services.auth, { name, slug, applicationId })
    return { ok: true }
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Couldn't create workspace." }
  }
}

export default function AdminWorkspaces({ loaderData }: Route.ComponentProps) {
  const { workspaces } = loaderData
  const actionData = useActionData<typeof action>()
  const nav = useNavigation()
  const busy = nav.state !== "idle"
  const error = actionData && "error" in actionData ? actionData.error : null

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>Create a workspace</CardTitle>
        </CardHeader>
        <CardContent>
          <Form method="post" className="flex flex-col gap-3">
            <div className="grid grid-cols-3 gap-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="name">Name</Label>
                <Input id="name" name="name" placeholder="Acme Corp" required disabled={busy} />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="slug">Slug</Label>
                <Input id="slug" name="slug" placeholder="acme" required disabled={busy} />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="applicationId">App key</Label>
                <Input
                  id="applicationId"
                  name="applicationId"
                  placeholder="invoices"
                  required
                  disabled={busy}
                />
              </div>
            </div>
            <Button type="submit" disabled={busy} className="self-start">
              {busy ? <Loader2 className="size-4 animate-spin" /> : null}
              Create
            </Button>
          </Form>
          {error ? <p className="text-destructive mt-3 text-sm">{error}</p> : null}
        </CardContent>
      </Card>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Slug</TableHead>
            <TableHead>App key</TableHead>
            <TableHead>Created</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {workspaces.length === 0 ? (
            <TableRow>
              <TableCell colSpan={4} className="text-muted-foreground">
                No workspaces yet.
              </TableCell>
            </TableRow>
          ) : (
            workspaces.map((w) => (
              <TableRow key={w.id}>
                <TableCell>{w.name}</TableCell>
                <TableCell className="text-muted-foreground">{w.slug}</TableCell>
                <TableCell>
                  {w.applicationId ? <Badge variant="secondary">{w.applicationId}</Badge> : "—"}
                </TableCell>
                <TableCell className="text-muted-foreground text-xs">
                  {new Date(w.createdAt).toLocaleDateString()}
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  )
}
