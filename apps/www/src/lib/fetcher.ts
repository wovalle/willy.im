type FetcherOpts = {
  revalidateIn?: number
}

export const revalidate = 3600 // revalidate the data at most every hour

export const fetcher = async function <T = unknown>(input: RequestInfo, opts?: FetcherOpts) {
  // const opts = {
  //   next: {
  //     revalidate:  opts?.revalidateIn
  //   }
  // }

  const res = await fetch(input)
  return res.json() as Promise<T>
}
