#!/usr/bin/env node
// One-time migration: move every row in the D1 `notes` table into bender's
// artifact store, and leave a `note_redirect:<oldId>` kv row behind so old
// /notes/:id links keep resolving.
//
// Usage (from apps/www):
//   BENDER_API_KEY=wak_... node scripts/migrate-notes-to-bender.mjs [--local]
//
// Requires: wrangler auth for the D1 database, and a bender key holding
// artifacts:write. Idempotent: a note whose redirect row already exists is
// skipped, so a partial run can simply be re-run.

import { execFileSync } from "node:child_process"

const BENDER_API_URL = process.env.BENDER_API_URL ?? "https://bender.romo.fyi"
const BENDER_API_KEY = process.env.BENDER_API_KEY
if (!BENDER_API_KEY) {
  console.error("BENDER_API_KEY is required (a wak_ key with artifacts:write)")
  process.exit(1)
}

const remoteFlag = process.argv.includes("--local") ? "--local" : "--remote"

const d1 = (sql) => {
  const out = execFileSync(
    "npx",
    ["wrangler", "d1", "execute", "willy-im", remoteFlag, "--json", "--command", sql],
    { encoding: "utf8" },
  )
  return JSON.parse(out)[0].results
}

const slugify = (title) =>
  title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "note"

const notes = d1("SELECT id, title, content, created_at, updated_at FROM notes")
console.log(`${notes.length} note(s) in D1`)

for (const note of notes) {
  const existing = d1(
    `SELECT id FROM kv WHERE id = 'note_redirect:${note.id.replace(/'/g, "''")}'`,
  )
  if (existing.length > 0) {
    console.log(`skip ${note.id} — already migrated`)
    continue
  }

  const res = await fetch(`${BENDER_API_URL}/api/artifacts`, {
    method: "POST",
    headers: { "x-api-key": BENDER_API_KEY, "content-type": "application/json" },
    body: JSON.stringify({
      filename: `${slugify(note.title)}.md`,
      content: note.content || `# ${note.title}\n`,
      encoding: "utf8",
      title: note.title,
    }),
  })
  if (!res.ok) {
    console.error(`FAILED ${note.id}: ${res.status} ${await res.text()}`)
    process.exit(1)
  }
  const published = await res.json()
  const url =
    published.url ??
    `https://artifacts.mellen.do/a/${published.id}/${encodeURIComponent(published.filename)}`

  const kvValue = JSON.stringify({ url, artifactId: published.id }).replace(/'/g, "''")
  d1(
    `INSERT INTO kv (id, value) VALUES ('note_redirect:${note.id.replace(/'/g, "''")}', '${kvValue}')`,
  )
  console.log(`migrated ${note.id} -> ${url}`)
}

console.log("done — verify the redirects, then drop the notes table in a follow-up migration")
