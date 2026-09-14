/**
 * Where to land after sign-in, when something sent the user here on purpose.
 *
 * A bare `/login` lands on the console, which is right for someone who typed
 * the URL and wrong for someone who clicked "link your Discord" and expects to
 * end up back there. `?next=` carries that intent through the OTP round trip.
 *
 * Only a same-origin PATH is honoured, and the checks are the boring ones that
 * matter: it must start with a single "/", so neither an absolute URL
 * (`https://evil.test`) nor a protocol-relative one (`//evil.test`, which
 * browsers treat as absolute) can turn this into an open redirect on a domain
 * whose whole job is authentication.
 */
export function safeNext(search: string | URLSearchParams): string | null {
  const params = typeof search === "string" ? new URLSearchParams(search) : search
  const next = params.get("next")
  if (!next) return null
  if (!next.startsWith("/")) return null
  if (next.startsWith("//")) return null
  // A backslash is normalised to "/" by some browsers, so "/\evil.test" is the
  // protocol-relative case wearing a hat.
  if (next.startsWith("/\\")) return null
  return next
}
