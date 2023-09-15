const deploymentUrl = process.env.NEXT_PUBLIC_DEPLOYMENT_URL ?? process.env.NEXT_PUBLIC_VERCEL_URL

export const baseUrl =
  process.env.NODE_ENV === "development"
    ? "http://localhost:3000"
    : `https://${deploymentUrl ?? "willy.im"}`
