import { avatarPath } from "~/lib/avatar"
import { cn } from "~/lib/utils"

/**
 * A user's face. `src` is whatever we have on file; when that's null — which is
 * the common case, since nobody uploads a picture to an OTP login — this falls
 * back to the IdP's own avatar route, so it never renders empty.
 *
 * `alt=""` on purpose: every use site here puts the name or email next to it,
 * and a screen reader announcing "avatar" before that name is noise.
 */
export function Avatar({
  userId,
  src,
  size = 32,
  className,
}: {
  userId: string
  src?: string | null
  size?: number
  className?: string
}) {
  return (
    <img
      // Double for retina; the SVG scales, so this only sets the intrinsic size.
      src={src || avatarPath(userId, { size: size * 2 })}
      alt=""
      width={size}
      height={size}
      loading="lazy"
      className={cn("bg-muted shrink-0 rounded-full object-cover", className)}
      style={{ width: size, height: size }}
    />
  )
}
