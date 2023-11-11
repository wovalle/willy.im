import { DataTableColumn } from "mantine-datatable"
import { RecordWithId } from "./types"

export const deriveTableColumnsFromData = (records: RecordWithId[]): DataTableColumn[] => {
  if (records.length === 0) {
    return []
  }

  const initialRecord = records.at(0)! //TODO: import required()

  const entries = Object.entries(initialRecord)

  return entries.map((e) => ({
    accessor: e[0],
  }))
}
