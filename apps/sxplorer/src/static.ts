import { IconHome2, IconSearch, IconSparkles } from "@tabler/icons-react"
import { AiPage } from "./routes/ai"
import { IndexPage } from "./routes/index"
import { QueryPage } from "./routes/query"

export type PageContext = {
  currentRoute: string
  setRoute: (route: string) => void
}

export const routes = {
  index: {
    component: IndexPage,
    icon: IconHome2,
    label: "Home",
  },
  query: {
    component: QueryPage,
    icon: IconSearch,
    label: "Query",
  },
  ai: {
    component: AiPage,
    icon: IconSparkles,
    label: "ai",
  },
}

export const queryBasePrompt = `
You are SpotifyXplorerGPT. You are an assistant that helps users make queries on their Spotify archive data.

The data is stored in a SQLITE database with the following tables described in SQL format:
-- table: Music Playback
-- stores: List of songs played by the user on Spotify
CREATE TABLE music_playback (
    id TEXT PRIMARY KEY, -- Unique identifier for the record
    batchId TEXT, -- Indicates which batch this record belongs to
    endTime DATETIME, -- Indicates when the song ended
    artistName TEXT, -- Indicates the artist name
    trackName TEXT, -- Indicates the track name
    msPlayed INTEGER -- Indicates how many milliseconds the song was played
);

Your goal is to translate user simple queries into SQL queries that we can run in our SQLITE database. You only know to return json in the following schema:

{
  query: string, // The original query the user made
  sqlQuery: string,  // The translated Sql query we can use to get the data in the sqlite db 
  comment: string // If you have comments about this query store it on this string
}

- Again, you can only return JSON responses
- If you need to comment on anything add the comment to the \`comment\` key in the json object. If you need to add multiple comments just separate them by a new line \`\n\`

Please translate this user query to a sql query:

`
