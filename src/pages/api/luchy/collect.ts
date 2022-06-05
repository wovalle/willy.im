import type { NextApiRequest, NextApiResponse } from "next"
import prisma from "../../../lib/prisma"

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  console.log("Collect Called With", req.body)

  const body = JSON.parse(req.body)
  const url = new URL(body.url ?? "")
  const key = req.headers["x-luchy-key"]

  try {
    if (key !== process.env.LUCHY_KEY) {
      return res.status(401).json({ message: "Invalid Key" })
    }

    if (!req.url) {
      return res.status(400).json({ message: "Invalid `url` param" })
    }

    if (req.method !== "POST") {
      return res.status(405).json({ message: "Method not allowed" })
    }

    await prisma.pageview.upsert({
      where: {
        slug: url.pathname,
      },
      create: {
        slug: url.pathname,
        views: 0,
      },
      update: {
        slug: url.pathname,
        views: { increment: 1 },
      },
      select: {
        slug: true,
      },
    })

    return res.status(200).json({
      success: true,
    })
  } catch (e: any) {
    return res.status(500).json({ message: e?.message })
  }
}
