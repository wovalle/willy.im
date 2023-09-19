"use client"

import { IconStar } from "@tabler/icons-react"
import { GoodReadsReview } from "../../../lib/goodreads"
import { tweetIntent } from "../../../lib/static"
import { PageSection } from "../../components/PageSection"
import { usePagination } from "../../hooks/usePagination"
import { AboutListElement } from "./AboutListElement"
import { PaginationRow } from "./PaginationRow"

export const revalidate = 60 * 60 * 24 // 1 day

export const BooksSection = ({
  reviews,
  currentlyReading,
}: {
  reviews: GoodReadsReview[]
  currentlyReading: GoodReadsReview[]
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
      subtitle={<>{r.author}</>}
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
      bodyClassName="grid gap-4"
    >
      <fieldset className="relative grid rounded-xl border-2 border-dashed border-neuda bg-slate-50 p-4 dark:bg-slate-900/70">
        <legend className="ml-4">
          <strong className="w-32 rounded bg-neuli px-2 py-1 text-center text-xs font-bold text-neuda dark:bg-neuda dark:text-neuli">
            currently reading
          </strong>
        </legend>
        {currentlyReadingList.length ? (
          <ul className="grid grid-cols-1 md:grid-cols-2 md:gap-4">{currentlyReadingList}</ul>
        ) : (
          <article className="flex flex-col items-center gap-3">
            <div className="text-title">nothing really :(</div>
            <p>
              <a
                className="text-subtitle text-sm"
                href={`${tweetIntent}` + encodeURIComponent("hey @wovalle, you should read: ")}
                target="_blank"
              >
                recommend something
              </a>
            </p>
          </article>
        )}
      </fieldset>
      <ul className="-mx-2 grid grid-cols-1 md:grid-cols-2 md:gap-4 ">{reviewList}</ul>
      <PaginationRow pagination={pagination} />
    </PageSection>
  )
}
