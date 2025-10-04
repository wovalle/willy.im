const ranges = {
  d: 24 * 60 * 60 * 1000,
  h: 60 * 60 * 1000,
  m: 60 * 1000,
  s: 1000,
}
const keys = Object.keys(ranges) as Array<keyof typeof ranges>

type TimeString = `${number}${"d" | "h" | "m" | "s"}`

export function toMs(time: TimeString) {
  let total = 0

  for (const key of keys) {
    const index = time.indexOf(key)
    if (index === -1) {
      continue
    }

    const value = Number.parseInt(time.slice(0, index))

    if (Number.isNaN(value)) {
      throw new Error(`Invalid time string: ${time}`)
    }

    total += value * ranges[key]
  }

  return total
}
