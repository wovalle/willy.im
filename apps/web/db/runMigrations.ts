import { promises as fs } from "fs"
import { FileMigrationProvider, Kysely, Migrator } from "kysely"
import * as path from "path"
import { db } from "./kysely"

export async function runMigrations(db: Kysely<any>) {
  const migrator = new Migrator({
    db,
    provider: new FileMigrationProvider({
      fs,
      path,
      migrationFolder: path.join(__dirname, "migrations"),
    }),
  })

  const executeCommand = (command: string) => {
    switch (command) {
      case "up":
        return migrator.migrateToLatest()
      case "down":
        return migrator.migrateDown()
      default:
        throw new Error(`Unknown command: ${command}`)
    }
  }

  const args = process.argv.slice(2)

  const { error, results } = await executeCommand(args[0])

  if (error) {
    console.error("failed to run migration command: " + args[0])
    console.error(error)
    process.exit(1)
  }

  results?.forEach((it) => {
    if (it.status === "Success") {
      console.info(`Migration "${it.migrationName}" was executed successfully`)
    } else if (it.status === "Error") {
      console.error(`Failed to execute migration "${it.migrationName}"`)
    }
  })

  process.exit(0)
}

runMigrations(db)
