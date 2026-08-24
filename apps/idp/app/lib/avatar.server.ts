import { blobatar, type BlobatarOptions } from "blobatar"
import {
  happy,
  love,
  mad,
  sad,
  scared,
  shy,
  sick,
  sleepy,
  smug,
  surprised,
  thinking,
  unsure,
  wink,
} from "blobatar/expression"

/**
 * Renders the blobatar behind `GET /avatar/:seed`.
 *
 * The route is public and never touches the database: a blobatar is a pure
 * function of the seed, so it neither confirms a user exists nor leaks anything
 * about one who does. That's what lets it be used from an email, a Slack unfurl
 * or someone else's page — anywhere a session isn't.
 *
 * Every query parameter is *clamped*, never rejected. This URL is consumed by
 * `<img src>`, where a 400 is a broken image; a size of 99999 has an obvious
 * sane answer and returning it beats a hole in the page.
 */

/** The poses `?expression=` accepts. `idle` is the default, so it needs no entry. */
const EXPRESSIONS = {
  happy,
  love,
  mad,
  sad,
  scared,
  shy,
  sick,
  sleepy,
  smug,
  surprised,
  thinking,
  unsure,
  wink,
} satisfies Record<string, BlobatarOptions["expression"]>

/** `?background=none` renders transparent; anything else falls back to the default. */
const BACKGROUNDS = ["square", "circle", "squircle"] as const

const DEFAULT_SIZE = 128
const MIN_SIZE = 8
const MAX_SIZE = 1024
const TITLE_MAX = 128

/**
 * A week. The markup is deterministic per (seed, options) within a blobatar
 * major, so this could be `immutable` — but a major bump would then be a year
 * of stale faces in every cache we don't control, and a week is already free.
 */
const MAX_AGE = 604800

/** Clamped number, or undefined when the parameter is absent or junk. */
function num(raw: string | null, min: number, max: number): number | undefined {
  if (raw === null) return undefined
  const value = Number(raw)
  if (!Number.isFinite(value)) return undefined
  return Math.min(max, Math.max(min, value))
}

/**
 * FNV-1a over the markup. An ETag only has to change when the bytes do, so a
 * non-cryptographic hash is the right tool — and it's synchronous, which
 * WebCrypto isn't.
 */
function etagFor(svg: string): string {
  let hash = 0x811c9dc5
  for (let i = 0; i < svg.length; i++) {
    hash ^= svg.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return `"${(hash >>> 0).toString(36)}"`
}

function optionsFrom(params: URLSearchParams): BlobatarOptions {
  const background = params.get("background")
  const expression = params.get("expression")
  const title = params.get("title")
  const hue = num(params.get("hue"), 0, 360)
  const tone = num(params.get("tone"), 0, 1)

  return {
    size: num(params.get("size"), MIN_SIZE, MAX_SIZE) ?? DEFAULT_SIZE,
    ...(background
      ? {
          background: BACKGROUNDS.includes(background as (typeof BACKGROUNDS)[number])
            ? (background as (typeof BACKGROUNDS)[number])
            : false,
        }
      : {}),
    ...(hue !== undefined ? { hue } : {}),
    ...(tone !== undefined ? { tone } : {}),
    ...(expression && expression in EXPRESSIONS
      ? { expression: EXPRESSIONS[expression as keyof typeof EXPRESSIONS] }
      : {}),
    // blobatar escapes this into the <title>; the cap is ours, so a long query
    // string can't inflate the response.
    ...(title ? { title: title.slice(0, TITLE_MAX) } : {}),
  }
}

export function renderAvatar(seed: string, request: Request): Response {
  const svg = blobatar(seed, optionsFrom(new URL(request.url).searchParams))
  const etag = etagFor(svg)

  const headers = new Headers({
    "cache-control": `public, max-age=${MAX_AGE}`,
    etag,
  })

  if (request.headers.get("if-none-match") === etag) {
    return new Response(null, { status: 304, headers })
  }

  headers.set("content-type", "image/svg+xml; charset=utf-8")
  // We generate this markup ourselves and blobatar escapes the one caller-supplied
  // string in it, but an SVG served from the issuer's own origin is a document
  // when navigated to directly — so state that it may load nothing.
  headers.set("content-security-policy", "default-src 'none'")
  headers.set("x-content-type-options", "nosniff")
  return new Response(svg, { headers })
}
