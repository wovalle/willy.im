import { IconCaretLeft, IconCaretRight } from "@tabler/icons-react"
import type { UsePaginationResponse } from "~/hooks/use-pagination"
import { cn } from "~/lib/cn"

export const PaginationRow = ({ pagination }: { pagination: UsePaginationResponse }) => (
  <article className="flex justify-center md:justify-end">
    <div className="flex items-center gap-5">
      <button
        type="button"
        className={cn("flex cursor-pointer select-none items-center text-xs", {
          invisible: pagination.page <= 0,
        })}
        data-luchy-event="pagination-back-click"
        onClick={() => {
          pagination.prev()
        }}
      >
        <IconCaretLeft /> prev
      </button>
      <span className="text-semibold text-sm">{`${pagination.page + 1} / ${
        pagination.totalPages
      }`}</span>
      <button
        type="button"
        className={cn("flex cursor-pointer select-none items-center text-xs", {
          invisible: pagination.page >= pagination.totalPages - 1,
        })}
        data-luchy-event="pagination-forward-click"
        onClick={() => {
          pagination.next()
        }}
      >
        next <IconCaretRight />
      </button>
    </div>
  </article>
)
