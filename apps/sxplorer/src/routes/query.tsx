import {
  ActionIcon,
  Group,
  MultiSelect,
  Select,
  Stack,
  TextInput,
  rem,
  useMantineTheme,
} from "@mantine/core"
import { getHotkeyHandler, useShallowEffect } from "@mantine/hooks"
import { IconSearch } from "@tabler/icons-react"
import { CtxAsync, useDB, useQuery } from "@vlcn.io/react"
import { useState } from "react"
import { DataTable } from "../components/query/DataTable"
import { deriveTableColumnsFromData } from "../components/query/dataTableUtils"
import { RecordWithId, TableParams } from "../components/query/types"

// TODO: this might need a full sql parser
const getFullQueryFromParams = (initialQuery: string, params: TableParams) => {
  let fullQuery = initialQuery

  if (params.sortColumn) {
    fullQuery += ` order by ${params.sortColumn} ${params.sortDirection}`
  }

  fullQuery += ` limit ${params.pageSize} offset ${(params.page - 1) * params.pageSize}`

  return fullQuery
}

// Once you implement the sql parser, you can pass the ast and use it to do count query
const usePaginatedQuery = <T,>(ctx: CtxAsync, query: string, params: TableParams) => {
  const fullQuery = getFullQueryFromParams(query, params)
  const countQuery = useQuery<{ count: number }>(
    ctx,
    "select count(*) as count from music_playback"
  )

  const dataQuery = useQuery<T>(ctx, fullQuery)

  return {
    loading: countQuery.loading || dataQuery.loading,
    count: countQuery.data?.[0]?.count,
    data: dataQuery.data,
  }
}

const columnsMeta = {
  musicPlayback: {
    defaultHiddenFields: ["id", "batchId"],
  },
} as const

const useSelectedColumns = (
  allColumns: string[],
  entity: keyof typeof columnsMeta = "musicPlayback"
) => {
  const [selectedColumns, setSelectedColumns] = useState(allColumns)

  useShallowEffect(() => {
    const defaultHiddenFields = columnsMeta[entity].defaultHiddenFields

    if (defaultHiddenFields) {
      setSelectedColumns(allColumns.filter((c) => !defaultHiddenFields.includes(c)))
    }
  }, [allColumns])

  console.log("selected columns", selectedColumns)

  return {
    selectedColumns,
    setSelectedColumns,
  }
}

export const QueryPage = () => {
  const [query, setQuery] = useState("select * from music_playback")
  const [tableParams, setTableParams] = useState<TableParams>({
    page: 1,
    pageSize: 10,
    sortDirection: "ASC",
    withId: false,
    numberRows: true,
  })

  const [submittedQuery, setSubmittedQuery] = useState(query)
  const ctx = useDB("sxplorer")

  const dbQuery = usePaginatedQuery<RecordWithId>(ctx, submittedQuery, tableParams)
  const allColumns = deriveTableColumnsFromData(dbQuery.data)

  const theme = useMantineTheme()

  const handleSubmit = () => {
    const fullQuery = getFullQueryFromParams(query, tableParams)
    setSubmittedQuery(fullQuery)
  }

  console.log("count query", dbQuery.count)

  const { selectedColumns, setSelectedColumns } = useSelectedColumns(
    allColumns.map((c) => c.accessor)
  )

  const multiSelectPlaceholder =
    dbQuery.count === 0
      ? "Run query first"
      : selectedColumns.length === 0
      ? "Select columns"
      : undefined

  console.log("kkj", selectedColumns)

  return (
    <main>
      <Stack>
        <TextInput
          value={query}
          onChange={(event) => setQuery(event.currentTarget.value)}
          onKeyDown={getHotkeyHandler([["mod+Enter", handleSubmit]])}
          rightSection={
            <ActionIcon size={32} radius="xl" color={theme.primaryColor} variant="filled">
              <IconSearch
                style={{ width: rem(18), height: rem(18) }}
                stroke={1.5}
                onClick={() => {
                  handleSubmit()
                }}
              />
            </ActionIcon>
          }
        />
        <Group>
          <Select label="Page size" placeholder="" data={["10"]} defaultValue="10" />
          <MultiSelect
            checkIconPosition="right"
            data={allColumns.map((c) => c.accessor)}
            label="Control check icon"
            placeholder={multiSelectPlaceholder}
            value={selectedColumns}
            onChange={(value) => setSelectedColumns(value)}
          />
        </Group>

        <DataTable
          data={dbQuery.data}
          loading={dbQuery.loading}
          params={tableParams}
          count={dbQuery.count}
          setParams={(params: Partial<TableParams>) =>
            setTableParams({ ...tableParams, ...params })
          }
          columns={allColumns.filter((c) => selectedColumns.includes(c.accessor))}
        />
      </Stack>
    </main>
  )
}
