/**
 * Where a user's avatar lives.
 *
 * Every user has one. Most sign in with an email and never upload a picture,
 * which used to leave `user.image` null and every consumer app writing its own
 * initials-in-a-circle fallback. So the IdP renders one instead: a deterministic
 * blobatar (https://blobatar.dev), same input -> same avatar, forever.
 *
 * The seed is the user id rather than the email. An email change shouldn't
 * change someone's face, and an avatar URL ends up in `<img src>` on pages we
 * don't control — an opaque id belongs there, an address doesn't.
 *
 * Kept dependency-free and isomorphic so console components can build the path
 * without pulling the renderer into the browser bundle. The rendering half is
 * `avatar.server.ts`.
 */

export const AVATAR_PATH = "/avatar"

export type AvatarOptions = {
  /** Pixel size baked into the SVG's width/height. Omit to let CSS size it. */
  size?: number
}

/** The origin-relative avatar URL — what console markup wants. */
export function avatarPath(seed: string, options: AvatarOptions = {}): string {
  const query = options.size ? `?size=${options.size}` : ""
  return `${AVATAR_PATH}/${encodeURIComponent(seed)}${query}`
}

/** The absolute avatar URL — what goes in a `picture` claim or an API response. */
export function avatarUrl(origin: string, seed: string, options: AvatarOptions = {}): string {
  return new URL(avatarPath(seed, options), origin).toString()
}
