import { IconStar } from "@tabler/icons-react"
import { PageSection } from "~/components/layout/page-section"
import { usePagination } from "~/hooks/use-pagination"
import type { GoodreadsReview } from "~/modules/goodreads/goodreads.schemas"
import { AboutListElement } from "./about-list-element"
import { PaginationRow } from "./pagination-row"

export const BooksSection = ({
  reviews,
  currentlyReading,
}: {
  reviews: GoodreadsReview[]
  currentlyReading: GoodreadsReview[]
}) => {
  const pagination = usePagination({
    initialPage: 0,
    itemsPerPage: 6,
    items: reviews,
  })

  const currentlyReadingList = currentlyReading.map((r) => (
    <AboutListElement
      key={r.url}
      title={r.title}
      subtitle={r.author}
      withHover={false}
      url={r.url}
    />
  ))

  const reviewList = pagination.items.map((r) => (
    <AboutListElement
      key={r.url}
      title={r.title}
      subtitle={r.author}
      url={r.url}
      withHover={false}
      leftPanel={() => (
        <div className="text-subtitle flex items-center self-start text-xs font-bold leading-6">
          {r.rating} <IconStar size="1.2em" className="ml-1 text-yellow-500" />
        </div>
      )}
    />
  ))

  return (
    <PageSection
      id="books"
      title="what i've been reading"
      subtitle="or listening, whatever, love audiobooks"
      bodyClassName="flex flex-col gap-4"
    >
      <fieldset
        className="border-neuda relative rounded-xl border-2 border-dashed bg-slate-50 p-4 dark:bg-slate-900/70"
        style={
          currentlyReading.length === 1
            ? {
                width: "50%",
              }
            : undefined
        }
      >
        <legend className="flex p-2 py-1">
          <strong className="bg-neuli text-neuda dark:bg-neuda dark:text-neuli rounded text-center text-xs font-bold">
            currently reading
          </strong>
        </legend>
        {currentlyReadingList.length > 0 ? (
          <ul className="md:gap-4">{currentlyReadingList}</ul>
        ) : (
          <article className="flex flex-col items-center gap-3">
            <div className="text-title">nothing really :(</div>
            <p>
              <a
                className="text-subtitle text-sm"
                href="https://twitter.com/intent/tweet?text=hey @wovalle, you should read: "
                target="_blank"
                rel="noreferrer"
              >
                recommend something
              </a>
            </p>
          </article>
        )}
      </fieldset>
      <ul className="-mx-2 grid grid-cols-1 md:grid-cols-2 md:gap-4">{reviewList}</ul>
      <PaginationRow pagination={pagination} />
    </PageSection>
  )
}
