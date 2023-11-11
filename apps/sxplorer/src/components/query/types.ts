export type TableParams = {
  page: number
  pageSize: number
  sortColumn?: string
  sortDirection: "ASC" | "DESC"
  withId: boolean
  numberRows: boolean
}

export type RecordWithId = Record<string, unknown> & { id: string }
