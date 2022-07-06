import { NextFetchEvent, NextRequest, NextResponse } from "next/server"

const baseUrl =
  process.env.NODE_ENV === "development" ? "http://localhost:3000" : "https://willy.im"

export async function middleware(req: NextRequest, event: NextFetchEvent) {
  const url = req.nextUrl.clone()

  // TODO: Ignore files, do we have to ignore head as well?
  if (url.pathname.includes(".") || req.method === "HEAD") {
    return NextResponse.next()
  }

  event.waitUntil(
    fetch(`${baseUrl}/api/luchy/collect`, {
      method: "POST",

      body: JSON.stringify({
        url: url.href,
      }),

      headers: {
        "x-luchy-key": process.env.LUCHY_KEY ?? "",
      },
    })
      .then((res) => (res.status > 400 ? Promise.reject(res) : res.json()))
      .catch(async (e) => {
        // TODO: proper error handling
        const json = await e.json()
        console.error("err", json)
      })
  )
}
