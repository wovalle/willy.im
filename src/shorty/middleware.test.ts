import { registerMiddleware, ShortyOpts } from "./middleware"
import { mock } from "jest-mock-extended"
import { NextRequest, NextResponse } from "next/server"

jest.mock("next/server")

const getMockUrl = (method: string, basePath: string | undefined, path: string) => {
  const bPath = basePath === "/" ? "" : basePath

  const nextUrl = mock<NextRequest["nextUrl"]>({
    pathname: `${bPath}${path}`,
  })

  return {
    method,
    nextUrl,
  }
}

describe("Shortify Middleware", () => {
  describe.each(["", "/", "/base"])(
    'when the middleware is registered in basePath "%s"',
    (basePath) => {
      const onUrlCreate = jest.fn()
      const onUrlGet = jest.fn()
      const onAccessDenied = jest.fn()
      const onExpired = jest.fn()

      const callMiddleware = (
        partialReq: Partial<NextRequest> = {},
        opts: ShortyOpts = {
          basePath,
          onUrlCreate,
          onUrlGet,
          onAccessDenied,
          onExpired,
          prepend: "",
        }
      ) => registerMiddleware(mock<NextRequest>(partialReq), opts)

      describe("Shorty Middleware", () => {
        describe(`when navigating to ${basePath}`, () => {
          const params = getMockUrl("GET", basePath, "/")

          it("should call next middlewares", async () => {
            await callMiddleware(params)

            expect(NextResponse.next).toHaveBeenCalled()
          })
        })

        describe(`when navigating to ${basePath}/key`, () => {
          const params = getMockUrl("GET", basePath, "/key")

          describe("and onUrlGet returns a valid entity", () => {
            const entity = { to: "https://willy.im", key: "key" }

            it("should redirect to the entity url", async () => {
              onUrlGet.mockResolvedValue(entity)

              await callMiddleware(params)

              expect(NextResponse.redirect).toHaveBeenCalledWith("https://willy.im")
            })
          })

          describe("and onUrlGet returns an invalid entity", () => {
            it("should throw validation error", async () => {
              onUrlGet.mockResolvedValueOnce(null)

              await expect(callMiddleware(params)).rejects.toThrowError(
                "Expected an object, but received: null"
              )

              onUrlGet.mockResolvedValueOnce({ key: "" })
              await expect(callMiddleware(params)).rejects.toThrowError(
                "At path: key -- Expected a nonempty string but received an empty one"
              )

              onUrlGet.mockResolvedValueOnce({})
              await expect(callMiddleware(params)).rejects.toThrowError(
                "At path: key -- Expected a string, but received: undefined"
              )
            })
          })
        })

        describe("when navigating to /key", () => {
          const params = getMockUrl("GET", basePath, "/key")

          describe("and onUrlGet returns a valid entity", () => {
            const entity = { to: "https://willy.im", key: "key" }

            it("should redirect to the entity url", async () => {
              onUrlGet.mockResolvedValue(entity)

              await callMiddleware(params)

              expect(NextResponse.redirect).toHaveBeenCalledWith("https://willy.im")
            })
          })

          describe("and onUrlGet returns an invalid entity", () => {
            it("should throw validation error", async () => {
              onUrlGet.mockResolvedValueOnce(null)

              await expect(callMiddleware(params)).rejects.toThrowError(
                "Expected an object, but received: null"
              )

              onUrlGet.mockResolvedValueOnce({ key: "" })
              await expect(callMiddleware(params)).rejects.toThrowError(
                "At path: key -- Expected a nonempty string but received an empty one"
              )

              onUrlGet.mockResolvedValueOnce({})
              await expect(callMiddleware(params)).rejects.toThrowError(
                "At path: key -- Expected a string, but received: undefined"
              )
            })
          })
        })
      })
    }
  )
})
