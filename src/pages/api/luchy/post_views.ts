import type { NextApiRequest, NextApiResponse } from "next"
import prisma from "../../../lib/prisma"

// TODO: use generic handlers
export type PostViewsApiSuccess = {
  views: number
}

export type PostViewsApiFailure = {
  message: string
}

export type PostViewsApi = PostViewsApiSuccess | PostViewsApiFailure

export default async function handler(req: NextApiRequest, res: NextApiResponse<PostViewsApi>) {
  const slug = req.query.slug
  try {
    if (!slug || Array.isArray(slug)) {
      return res.status(400).json({ message: "Invalid `slug` param" })
    }

    if (req.method !== "GET") {
      return res.status(405).json({ message: "Method not allowed" })
    }

    const post = await prisma.pageview.findUnique({
      where: {
        slug: `/posts/${slug}`,
      },
      select: {
        views: true,
      },
    })

    return res.status(200).json({
      views: post?.views ?? 0,
    })
  } catch (e: any) {
    console.error(e)
    return res.status(500).json({ message: "Oops, internal error" })
  }
}
