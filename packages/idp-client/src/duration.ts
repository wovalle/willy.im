/**
 * `"7d"` -> milliseconds. Config reads better as a duration string than as a
 * number of milliseconds nobody can eyeball; numbers are still accepted and
 * treated as milliseconds.
 */

export type Duration = number | `${number}${"ms" | "s" | "m" | "h" | "d" | "w"}`

const UNITS: Record<string, number> = {
  ms: 1,
  s: 1000,
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
  w: 604_800_000,
}

export function parseDuration(value: Duration): number {
  if (typeof value === "number") {
    if (!Number.isFinite(value) || value < 0) throw new Error(`invalid duration: ${value}`)
    return value
  }
  const match = /^(\d+(?:\.\d+)?)(ms|s|m|h|d|w)$/.exec(value.trim())
  if (!match) throw new Error(`invalid duration: ${value}`)
  return Number(match[1]) * UNITS[match[2]]
}
