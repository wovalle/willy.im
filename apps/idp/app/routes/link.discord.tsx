import { Form, Link, redirect } from "react-router"
import { eq, and } from "drizzle-orm"

import type { Route } from "./+types/link.discord"
import * as schema from "~/db/schema"
import { Button } from "~/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card"

/**
 * Self-service Discord linking.
 *
 * The problem this solves: bender hears from a Discord snowflake and asks the
 * IdP who that is. Until now the only answer was a row a superadmin had typed
 * in by hand, which meant every new person needed Willy at a keyboard. Now
 * bender posts a link to this page, the person signs in and consents, and
 * Discord itself tells us the snowflake — no shared secret to deliver, so the
 * link is safe to post in a channel where other people can read it. Whoever
 * completes the flow links THEIR account and nobody else's.
 *
 * Permissions are deliberately NOT granted here. Linking answers "who is this";
 * what they may do stays an admin's decision in the console. A freshly linked
 * person is known and still has no grants, which is the same place a new member
 * starts.
 */

const PROVIDER = "discord"

/** Better Auth's callback error codes, in words the person can act on. */
function errorMessage(code: string): string {
  switch (code) {
    case "unable_to_link_account":
      return "Discord says the email on that account isn't verified. Verify it in Discord (User Settings → My Account), then try again."
    case "account_already_linked_to_different_user":
      return "That Discord account is already linked to a different willy.im account. Ask Willy to move it."
    case "access_denied":
      return "Discord sign-in was cancelled. Nothing changed — try again."
    default:
      return `Discord didn't complete the connection (${code}). Nothing changed — try again.`
  }
}

export function meta() {
  return [{ title: "Link Discord · willy.im" }]
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const session = await context.services.auth.api.getSession({ headers: request.headers })
  // `next` so the login bounce comes back here rather than dumping them on the
  // console with no idea whether the thing they clicked worked.
  if (!session) throw redirect(`/login?next=${encodeURIComponent("/link/discord")}`)

  const [linked] = await context.db
    .select({ externalId: schema.linkedIdentity.externalId })
    .from(schema.linkedIdentity)
    .where(
      and(
        eq(schema.linkedIdentity.userId, session.user.id),
        eq(schema.linkedIdentity.provider, PROVIDER),
      ),
    )
    .limit(1)

  return {
    email: session.user.email,
    linkedId: linked?.externalId ?? null,
    configured: !!context.getAppEnv("DISCORD_CLIENT_ID") && !!context.getAppEnv("DISCORD_CLIENT_SECRET"),
    error: new URL(request.url).searchParams.get("error"),
  }
}

export async function action({ request, context }: Route.ActionArgs) {
  const session = await context.services.auth.api.getSession({ headers: request.headers })
  if (!session) throw redirect(`/login?next=${encodeURIComponent("/link/discord")}`)

  // Better Auth hands back the provider URL to bounce to. The callback lands on
  // /auth/callback/discord, writes the `account` row, and the account.create
  // hook (auth.server.ts) mirrors it into linked_identity — then Discord sends
  // the browser to callbackURL, which is this page, now showing the link.
  const res = await context.services.auth.api.linkSocialAccount({
    body: {
      provider: PROVIDER,
      callbackURL: "/link/discord",
      // Better Auth appends `?error=<code>`, which the loader reads.
      errorCallbackURL: "/link/discord",
    },
    headers: request.headers,
  })
  throw redirect(res.url)
}

export default function LinkDiscord({ loaderData }: Route.ComponentProps) {
  const { email, linkedId, configured, error } = loaderData

  return (
    <main id="main" className="mx-auto flex min-h-svh max-w-md items-center justify-center p-6">
      <Card className="w-full">
        <CardHeader>
          <CardTitle>{linkedId ? "Discord is linked" : "Link your Discord account"}</CardTitle>
          <CardDescription>
            {linkedId ? (
              <>
                Signed in as <strong>{email}</strong>. Bender knows who you are on Discord.
              </>
            ) : (
              <>
                Bender answers people it can identify. Connect Discord to <strong>{email}</strong>{" "}
                so it knows your messages are yours.
              </>
            )}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {error ? (
            <p className="text-destructive text-sm">
              {errorMessage(error)}
            </p>
          ) : null}

          {linkedId ? (
            <>
              <p className="text-muted-foreground text-sm">
                Discord id <code>{linkedId}</code>. If bender still doesn't answer you, it's
                permissions, not identity — ask Willy.
              </p>
              <Button variant="outline" render={<Link to="/account">Go to your account</Link>} />
            </>
          ) : configured ? (
            <Form method="post">
              <Button type="submit">Connect Discord</Button>
            </Form>
          ) : (
            <p className="text-muted-foreground text-sm">
              Discord sign-in isn't configured on this deployment, so there's nothing to connect
              yet.
            </p>
          )}
        </CardContent>
      </Card>
    </main>
  )
}
