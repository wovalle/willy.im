export const required = <T>(value: T | undefined | null, error?: string): T => {
  if (value === undefined || value === null) {
    throw new Error(error ?? `Value is required`)
  }

  return value
}
