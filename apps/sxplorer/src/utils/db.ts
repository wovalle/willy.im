import { CtxAsync } from "@vlcn.io/react"
import { Output, array, literal, number, object, safeParse, string } from "valibot"

const trackBaseSchema = {
  artistName: string(),
  msPlayed: number(),
  endTime: string(),
  trackName: string(),
}

export const trackSchema = object({
  id: string(),
  ...trackBaseSchema,
})

export const fileInputSchema = object({
  id: string(),
  batchId: string(),
  type: literal("music_playback"),
  records: number(),
})

const trackInputSchema = array(object(trackBaseSchema))

export type Track = Output<typeof trackSchema>

export type TracksInput = Output<typeof trackInputSchema>[]

export const db = {
  insertFile: async (ctx: CtxAsync, fileInput: unknown) => {
    const file = safeParse(fileInputSchema, fileInput)

    if (!file.success) {
      console.error("failed to parse file", file.issues)
      return
    }

    console.log("about to insert file", file, [
      file.output.id,
      file.output.batchId,
      file.output.type,
      file.output.records,
    ])

    await ctx.db.exec(
      `INSERT OR REPLACE INTO files (id, batchId, fileType, records) VALUES (?, ?, ?, ?);`,
      [file.output.id, file.output.batchId, file.output.type, file.output.records]
    )
  },

  insertTracks: async (ctx: CtxAsync, batch: string, tracksInput: unknown[]) => {
    const tracks = safeParse(trackInputSchema, tracksInput)

    if (!tracks.success) {
      console.error("failed to parse", tracks.issues)
      return
    }

    console.log("about to insert tracks", tracks)
    // TODO: add some progress bar because there's

    const result = {
      inserted: 0,
      errors: [] as string[],
    }

    for (const track of tracks.output) {
      try {
        await ctx.db.exec(
          `INSERT INTO music_playback (id, batchId, trackName, artistName, endTime, msPlayed) VALUES (?, ?, ?, ?, ?, ?);`,
          [
            crypto.randomUUID(),
            batch,
            track.trackName,
            track.artistName,
            track.endTime,
            track.msPlayed,
          ]
        )
        result.inserted++
      } catch (e) {
        console.error("failed to insert track", e, track)
        result.errors.push("message" in e ? e.message : JSON.stringify(e))
      }
    }

    return result
  },
}
