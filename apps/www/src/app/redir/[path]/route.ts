import { notFound } from "next/navigation"
import { NextResponse } from "next/server"
import { getDb } from "../../../db/kysely"

export async function GET(req: Request, { params }: { params: { path: string } }) {
  const db = getDb()

  const redirect = await db
    .selectFrom("redirects")
    .selectAll()
    .where("id", "=", params.path)
    .execute()

  if (redirect.length === 0) {
    notFound()
  }

  return NextResponse.redirect(redirect[0].url)
}

export const runtime = "edge"
