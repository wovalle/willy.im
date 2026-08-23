import { Link } from "react-router"

import type { Route } from "./+types/users"
import { listUsers } from "~/lib/admin.server"
import { requireConsoleCaller } from "~/lib/caller.server"
import { Badge } from "~/components/ui/badge"
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
  return { users: await listUsers(context) }
}

export default function AdminUsers({ loaderData }: Route.ComponentProps) {
  const { users } = loaderData
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Email</TableHead>
          <TableHead>Name</TableHead>
          <TableHead>Verified</TableHead>
          <TableHead>Joined</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {users.length === 0 ? (
          <TableRow>
            <TableCell colSpan={4} className="text-muted-foreground">
              No users yet.
            </TableCell>
          </TableRow>
        ) : (
          users.map((u) => (
            <TableRow key={u.id}>
              <TableCell>
                {/* The email is the row's handle into the user's detail view, where
                    a superadmin manages their linked identities. */}
                <Link
                  to={`/users/${u.id}`}
                  className="font-medium underline-offset-4 hover:underline"
                >
                  {u.email}
                </Link>
              </TableCell>
              <TableCell>{u.name || "—"}</TableCell>
              <TableCell>
                {u.emailVerified ? <Badge variant="secondary">verified</Badge> : "—"}
              </TableCell>
              <TableCell className="text-muted-foreground text-xs">
                {new Date(u.createdAt).toLocaleDateString()}
              </TableCell>
            </TableRow>
          ))
        )}
      </TableBody>
    </Table>
  )
}
