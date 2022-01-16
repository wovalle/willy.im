import { registerMiddleware, ShortyOpts } from "./middleware"
import { mock } from "jest-mock-extended"
import { NextRequest } from "next/server"

const getMockUrl = (url?: string) => (url ? `/s` + url : url)

describe("Shortify Middleware", () => {
  describe("when the middleware is registered", () => {
    const baseUrl = "/s"

    const onUrlCreate = jest.fn()
    const onUrlGet = jest.fn()
    const onAccessDenied = jest.fn()
    const onExpired = jest.fn()

    const callMiddleware = (
      partialReq: Partial<NextRequest> = {},
      opts: ShortyOpts = {
        basePath: "/",
        onUrlCreate,
        onUrlGet,
        onAccessDenied,
        onExpired,
        prepend: "",
      }
    ) => registerMiddleware(mock<NextRequest>(partialReq), opts)

    describe("Shorty Middleware", () => {
      describe("on GET basePath", () => {
        it("should call onUrlGet", async () => {
          await callMiddleware({ url: getMockUrl(), method: "GET" })
          expect(onUrlGet).toHaveBeenCalled()
        })
      })
    })
  })
})
