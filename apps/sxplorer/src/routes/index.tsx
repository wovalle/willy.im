import { FileWithPath } from "@mantine/dropzone"
import { CtxAsync, useDB, useQuery } from "@vlcn.io/react"
import { BlobReader, BlobWriter, ZipReader } from "@zip.js/zip.js"
import { useState } from "react"
import { Input, array, number, object, safeParse, string } from "valibot"
import { DropzoneButton } from "../components/index/Dropzone"
import { StatsBar } from "../components/index/StatsBar"
import { db, trackSchema } from "../utils/db"

const fileSchema = object({
  id: string(),
  name: string(),
  size: number(),
})

type FileWithGetData = Input<typeof fileSchema> & { getJson: () => Promise<string> }

const useFilesHandler = () => {
  const [fileInput, setFileInput] = useState<FileWithPath[] | null>(null)
  const [files, setFiles] = useState<FileWithGetData[]>([])

  let errorReason

  return {
    onFiles: async (input: FileWithPath[]) => {
      console.log("got files")
      setFileInput(input)

      if (input?.length > 1) {
        errorReason = "Only one file at a time"
      }

      // eslint-disable-next-line @typescript-eslint/no-non-null-asserted-optional-chain
      const fileWithPath = fileInput?.[0]!

      if (fileWithPath && fileWithPath.type !== "application/zip") {
        errorReason = "Only zip files"
      }

      const entries = await new ZipReader(new BlobReader(fileWithPath)).getEntries({
        filenameEncoding: "utf-8",
      })

      const f = entries.map((e) => ({
        id: e.filename.split("/").at(-1) ?? e.filename,
        name: e.filename,
        size: e.uncompressedSize,
        getJson: () => e?.getData(new BlobWriter("application/json")).then((b) => b.text()),
      }))

      setFiles(f)
    },

    errorReason,
    files,
    clear: () => {
      setFileInput(null)
      setFiles([])
    },
  }
}

const insertFiles = async (ctx: CtxAsync, files: FileWithGetData[]) => {
  console.log("insert files", files)
  const filesToScan = {
    "StreamingHistory0.json": "music_playback",
  } as const

  const filesToInsert = files.filter((file) => {
    return filesToScan[file.id as keyof typeof filesToScan]
  })

  for (const file of filesToInsert) {
    console.log(file)

    const data = await file.getJson()
    const batchId = crypto.randomUUID()

    switch (filesToScan[file.id as keyof typeof filesToScan]) {
      case "music_playback": {
        const tracks = JSON.parse(data) as unknown[]

        await db.insertFile(ctx, {
          id: crypto.randomUUID(),
          batchId,
          type: "music_playback",
          records: tracks.length,
        })

        await db.insertTracks(ctx, batchId, tracks)

        break
      }

      default: {
        console.log("nope")
      }
    }
  }
}

export const IndexPage = () => {
  const ctx = useDB("sxplorer")

  const filesQ = useQuery(ctx, "SELECT * FROM files")
  const tracksQ = useQuery(ctx, "SELECT count(*) as count FROM music_playback ")

  const files = safeParse(array(fileSchema), filesQ.data)
  const tracks = safeParse(array(trackSchema), tracksQ.data)

  const filesHandler = useFilesHandler()

  let component

  if (files.success && tracks.success && tracks.output.length) {
    component = (
      <>
        <ul>
          {files.output.map((file) => (
            <li key={file.id}>{file.name}</li>
          ))}
        </ul>

        <ul>
          {tracks.output.map((t) => (
            <li key={t.id}>
              {t.trackName} - {t.artistName}
            </li>
          ))}
        </ul>
      </>
    )
  } else {
    if (filesHandler.files.length) {
      component = (
        <>
          <ul>
            {filesHandler.files.map((file) => (
              <li key={file.id}>{file.name}</li>
            ))}
          </ul>
          <button onClick={() => insertFiles(ctx, filesHandler.files)}>insert</button>
        </>
      )
    } else {
      component = (
        <>
          <h2>No files found</h2>
          <h2>Upload Zip</h2>
          <DropzoneButton onDrop={filesHandler.onFiles} />
          {filesHandler.errorReason ? <p>{filesHandler.errorReason}</p> : null}
        </>
      )
    }
  }

  return (
    <section>
      <h1>Index</h1>

      <hr />

      <StatsBar />

      <div>
        <h2>Files</h2>
        <button
          onClick={() => {
            ctx.db.exec("DELETE FROM files")
            ctx.db.exec("DELETE FROM music_playback")
            filesHandler.clear()
          }}
        >
          delete
        </button>
      </div>
      {component}
    </section>
  )
}
