import { safeNext as safePath } from "@willyim/idp"

/**
 * Where to land after sign-in, when something sent the user here on purpose.
 *
 * A bare `/login` lands on the console, which is right for someone who typed
 * the URL and wrong for someone who clicked "link your Discord" and expects to
 * end up back there. `?next=` carries that intent through the OTP round trip.
 *
 * Only a same-origin PATH is honoured, by the same check every app's auth
 * callback uses (`safeNext` from `@willyim/idp`): one leading "/" not followed
 * by "/" or "\", no backslash, control character or whitespace, raw or
 * percent-decoded, and it must resolve to this origin. On a domain whose whole
 * job is authentication, anything looser is an open redirect.
 */
export function safeNext(search: string | URLSearchParams): string | null {
  const params = typeof search === "string" ? new URLSearchParams(search) : search
  return safePath(params.get("next")) ?? null
}
