import { DataTableColumn, DataTable as MantineDataTable } from "mantine-datatable"
import { RecordWithId, TableParams } from "./types"

export const DataTable = (opts: {
  data: RecordWithId[]
  loading: boolean
  params: TableParams
  count?: number
  setParams: (params: Partial<TableParams>) => void
  columns: DataTableColumn[]
}) => {
  return (
    <MantineDataTable
      withTableBorder
      borderRadius="sm"
      withColumnBorders
      striped
      highlightOnHover
      // provide data
      records={opts.data ?? []}
      // define columns
      columns={opts.columns}
      // execute this callback when a row is clicked
      onRowClick={({ record }) => {
        console.log(record)
      }}
      totalRecords={opts.count}
      recordsPerPage={opts.params.pageSize}
      page={opts.params.page}
      onPageChange={(p) => opts.setParams({ page: p })}
      fetching={opts.loading}
      // 👇 uncomment the next line to use a custom pagination size
      // paginationSize="md"
      // 👇 uncomment the next line to use a custom loading text
      loadingText="Loading..."
      // 👇 uncomment the next line to display a custom text when no records were found
      noRecordsText="No records found"
      // 👇 uncomment the next line to use a custom pagination text
      // paginationText={({ from, to, totalRecords }) => `Records ${from} - ${to} of ${totalRecords}`}
      // 👇 uncomment the next lines to use custom pagination colors
      // paginationActiveBackgroundColor="green"
      // paginationActiveTextColor="#e6e348"
    />
  )
}
