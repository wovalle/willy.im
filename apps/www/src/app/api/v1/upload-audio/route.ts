import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3"
import { getSignedUrl } from "@aws-sdk/s3-request-presigner"
import { NextResponse } from "next/server"

const S3 = new S3Client({
  region: "auto",
  endpoint: `https://${process.env.CLOUDFLARE_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.CLOUDFLARE_R2_ACCESS_KEY_ID!,
    secretAccessKey: process.env.CLOUDFLARE_R2_SECRET_ACCESS_KEY!,
  },
})

export const POST = async (request: Request) => {
  const body = await request.json()

  const datePrefix = new Date()
    .toISOString()
    .replace(/:/g, "-")
    .replace("T", "-")
    .replace("Z", "")
    .replace(/\./g, "-")

  const fileKey = `${datePrefix}-${body.filename}`

  if (!body.token || body.token !== process.env.R2_UPLOAD_TOKEN) {
    return NextResponse.json({ error: "Invalid token" }, { status: 401 })
  }

  if (!body.filename) {
    return NextResponse.json({ error: "Invalid filename" }, { status: 400 })
  }

  const signedUrl = await getSignedUrl(
    S3,
    new PutObjectCommand({
      Bucket: process.env.R2_RECORDINGS_BUCKET_NAME,
      Key: fileKey,
    }),
    { expiresIn: 3600 }
  )

  return NextResponse.json({ signedUrl, fileKey })
}
