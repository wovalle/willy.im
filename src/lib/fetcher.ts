export const fetcher = async function <T = unknown>(input: RequestInfo) {
  const res = await fetch(input)
  return res.json() as Promise<T>
}
