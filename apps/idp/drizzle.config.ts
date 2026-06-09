import { defineConfig } from "drizzle-kit"

const LOCAL_DB_PATH = process.env.LOCAL_DB_PATH

export default LOCAL_DB_PATH
  ? defineConfig({
      dialect: "sqlite",
      out: "drizzle",
      schema: "./app/db/schema.ts",
      dbCredentials: {
        url: LOCAL_DB_PATH,
      },
    })
  : defineConfig({
      out: "./drizzle",
      schema: "./app/db/schema.ts",
      dialect: "sqlite",
      driver: "d1-http",
      dbCredentials: {
        databaseId: process.env.CLOUDFLARE_DATABASE_ID!,
        accountId: process.env.CLOUDFLARE_ACCOUNT_ID!,
        token: process.env.CLOUDFLARE_TOKEN!,
      },
    })
