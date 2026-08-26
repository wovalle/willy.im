import { Link, redirect } from "react-router"

import type { Route } from "./+types/invite.accept"
import { claimInvitationsForUser, getInvitationByToken } from "~/lib/members.server"
import { trackServerEvent } from "~/lib/luchy"
import { Button } from "~/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card"

export function meta() {
  return [{ title: "Accept invitation · willy.im" }]
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const token = new URL(request.url).searchParams.get("token") ?? ""
  const invite = token ? await getInvitationByToken(context, token) : null

  if (!invite) return { state: "invalid" as const }
  if (invite.expiresAt.getTime() < Date.now()) return { state: "expired" as const }

  const session = await context.services.auth.api.getSession({ headers: request.headers })

  // Already signed in as the invited email — claim now and land on the console.
  if (session && session.user.email.toLowerCase() === invite.email) {
    await claimInvitationsForUser(context, session.user)
    // Invitation acceptance is a GET side effect, so the Worker's mutation
    // sniffer never sees it — the one event emitted by hand.
    if (context.getAppEnv("APP_ENV") === "production") {
      context.cloudflare.ctx.waitUntil(
        trackServerEvent({
          name: "invite/accept:claim",
          pathname: "/invite/accept",
          userAgent: request.headers.get("user-agent") ?? undefined,
          payload: { user: session.user.id, app: invite.applicationId },
        }),
      )
    }
    throw redirect("/")
  }

  return {
    state: "ready" as const,
    app: invite.applicationId,
    role: invite.role,
    email: invite.email,
    signedInAs: session?.user.email ?? null,
  }
}

export default function InviteAccept({ loaderData }: Route.ComponentProps) {
  return (
    <main id="main" className="mx-auto flex min-h-svh max-w-md items-center justify-center p-6">
      <Card className="w-full">
        {loaderData.state === "ready" ? (
          <>
            <CardHeader>
              <CardTitle>You've been invited to {loaderData.app}</CardTitle>
              <CardDescription>
                Join <strong>{loaderData.app}</strong> as <strong>{loaderData.role}</strong> with{" "}
                {loaderData.email}.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              {loaderData.signedInAs ? (
                <p className="text-muted-foreground text-sm">
                  You're signed in as {loaderData.signedInAs}. Sign in as {loaderData.email} to
                  accept this invitation.
                </p>
              ) : null}
              <Button
                render={
                  <Link to={`/login?email=${encodeURIComponent(loaderData.email)}`}>
                    Accept &amp; sign in
                  </Link>
                }
              />
            </CardContent>
          </>
        ) : (
          <>
            <CardHeader>
              <CardTitle>
                {loaderData.state === "expired" ? "Invitation expired" : "Invalid invitation"}
              </CardTitle>
              <CardDescription>
                {loaderData.state === "expired"
                  ? "This invitation has expired. Ask an admin to send a new one."
                  : "This invitation link is invalid or has already been used."}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button variant="outline" render={<Link to="/login">Go to sign in</Link>} />
            </CardContent>
          </>
        )}
      </Card>
    </main>
  )
}
