import { useState } from "react"

export const usePagination = <T>(opts: {
  itemsPerPage: number
  items: T[]
  initialPage: number
}) => {
  const [page, setPage] = useState(opts.initialPage ?? 0)
  const totalPages = Math.ceil(opts.items.length / opts.itemsPerPage)

  const next = () => setPage((p) => Math.min(p + 1, totalPages - 1))
  const prev = () => setPage((p) => Math.max(p - 1, 0))

  return {
    page,
    next,
    prev,
    totalPages,
    items: opts.items.slice(page * opts.itemsPerPage, (page + 1) * opts.itemsPerPage),
  }
}

export type UsePaginationResponse = ReturnType<typeof usePagination>
