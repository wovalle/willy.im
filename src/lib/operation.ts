export type OperationSuccessResponse<T> = { status: "success"; data: T }
export type OperationFailureResponse = { status: "error"; message: string }
export type OperationResponse<T> = OperationSuccessResponse<T> | OperationFailureResponse

export function respond<T>(data: T): OperationSuccessResponse<T>
export function respond<T>(status: "success", data: T): OperationSuccessResponse<T>
export function respond(status: "error", message: string): OperationFailureResponse
export function respond<T>(
  statusOrData: T | "success" | "error",
  dataOrError?: T | string
): OperationResponse<T> {
  if (typeof dataOrError === "undefined" || statusOrData === "success") {
    return {
      status: "success",
      data: statusOrData as T,
    }
  }

  return {
    status: "error",
    message: dataOrError as string,
  }
}

export const respondError = (message: string) => respond("error", message)
