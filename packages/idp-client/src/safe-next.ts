/** Resolution base for {@link safeNext}; `https:` so the parser applies a browser's rules. */
const SAFE_NEXT_BASE = "https://safe-next.invalid"

/** A backslash, an ASCII control character, or any whitespace. */
const UNSAFE_NEXT_CHAR = /[\\\u0000-\u001f\u007f\s]/

/**
 * Only same-origin absolute paths survive as `?next=` — an open redirect is
 * not a feature. Browsers read `/\evil.example` as `//evil.example`, and strip
 * tabs and newlines before parsing, so `/\t/evil.example` is one too. Hence:
 * a single leading `/` not followed by `/` or `\`, no backslash, control
 * character or whitespace anywhere — in the raw value and once
 * percent-decoded — and it must still resolve to the same origin. Anything
 * else is dropped, and the caller falls back to its default.
 */
export function safeNext(next: string | null | undefined): string | undefined {
  if (!next) return undefined
  let decoded: string
  try {
    decoded = decodeURIComponent(next)
  } catch {
    return undefined
  }
  for (const form of [next, decoded]) {
    if (!form.startsWith("/") || form.startsWith("//")) return undefined
    if (UNSAFE_NEXT_CHAR.test(form)) return undefined
  }
  let resolved: URL
  try {
    resolved = new URL(next, SAFE_NEXT_BASE)
  } catch {
    return undefined
  }
  if (resolved.origin !== SAFE_NEXT_BASE) return undefined
  return next
}
