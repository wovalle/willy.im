/**
 * <div style={{display: "flex", justifyContent: "space-between", alignItems: "center", padding: 16}}>
 *  <p style={{fontWeight: "normal"}}>Official <a href="https://kysely.dev/">Kysely</a> adapter for Auth.js / NextAuth.js.</p>
 *  <a href="https://kysely.dev/">
 *   <img style={{display: "block"}} src="/img/adapters/kysely.svg" width="38" />
 *  </a>
 * </div>
 *
 * ## Installation
 *
 * ```bash npm2yarn2pnpm
 * npm install kysely @auth/kysely-adapter
 * ```
 *
 * @module @auth/kysely-adapter
 */

import { Kysely, SqliteAdapter } from "kysely"
import { AuthDb } from "./KyselyAuthInterface"

import type { Adapter } from "next-auth/adapters"

export const format = {
  /**
   * Helper function to return the passed in object and its specified prop
   * as an ISO string if SQLite is being used.
   */
  from<T extends Partial<Record<K, Date | null>>, K extends keyof T>(
    data: T,
    key: K,
    isSqlite: boolean,
  ) {
    const value = data[key]
    return {
      ...data,
      [key]: value && isSqlite ? value.toISOString() : value,
    }
  },
  to,
}

type ReturnData<T = never> = Record<string, Date | string | T>

/**
 * Helper function to return the passed in object and its specified prop as a date.
 * Necessary because SQLite has no date type so we store dates as ISO strings.
 */
function to<T extends Partial<ReturnData>, K extends keyof T>(
  data: T,
  key: K,
): Omit<T, K> & Record<K, Date>
function to<T extends Partial<ReturnData<null>>, K extends keyof T>(
  data: T,
  key: K,
): Omit<T, K> & Record<K, Date | null>
function to<T extends Partial<ReturnData<null>>, K extends keyof T>(data: T, key: K) {
  const value = data[key]
  return Object.assign(data, {
    [key]: value && typeof value === "string" ? new Date(value) : value,
  })
}

/**
 * 
 * ## Setup
 * 
 * This adapter supports the same first party dialects that Kysely (as of v0.24.2) supports: PostgreSQL, MySQL, and SQLite. The examples below use PostgreSQL with the [pg](https://www.npmjs.com/package/pg) client.
 * 
 *  ```bash npm2yarn2pnpm
 * npm install pg
 * npm install --save-dev @types/pg
 * ```
 * 
 * ```typescript title="pages/api/auth/[...nextauth].ts"
 * import NextAuth from "next-auth"
 * import GoogleProvider from "next-auth/providers/google"
 * import { KyselyAdapter } from "@auth/kysely-adapter"
 * import { db } from "../../../db"
 *
 * export default NextAuth({
 *   adapter: KyselyAdapter(db),
 *   providers: [
 *     GoogleProvider({
 *       clientId: process.env.GOOGLE_CLIENT_ID,
 *       clientSecret: process.env.GOOGLE_CLIENT_SECRET,
 *     }),
 *   ],
 * })
 * ```
 *
 * Kysely's constructor requires a database interface that contains an entry with an interface for each of your tables. You can define these types manually, or use `kysely-codegen` / `prisma-kysely` to automatically generate them. Check out the default [models](/reference/adapters#models) required by Auth.js.
 *
 * ```ts title="db.ts"
 * import { PostgresDialect } from "kysely"
 * import { Pool } from "pg"
 * 
 * // This adapter exports a wrapper of the original `Kysely` class called `KyselyAuth`,
 * // that can be used to provide additional type-safety.
 * // While using it isn't required, it is recommended as it will verify
 * // that the database interface has all the fields that Auth.js expects.
 * import { KyselyAuth } from "@auth/kysely-adapter"
 * 
 * import type { GeneratedAlways } from "kysely"
 *
 * interface Database {
 *   User: {
 *     id: GeneratedAlways<string>
 *     name: string | null
 *     email: string
 *     emailVerified: Date | null
 *     image: string | null
 *   }
 *   Account: {
 *     id: GeneratedAlways<string>
 *     userId: string
 *     type: stringw 
 *     provider: string
 *     providerAccountId: string
 *     refresh_token: string | null
 *     access_token: string | null
 *     expires_at: number | null
 *     token_type: string | null
 *     scope: string | null
 *     id_token: string | null
 *     session_state: string | null
 *   }
 *   Session: {
 *     id: GeneratedAlways<string>
 *     userId: string
 *     sessionToken: string
 *     expires: Date
 *   }
 *   VerificationToken: {
 *     identifier: string
 *     token: string
 *     expires: Date
 *   }
 * }
 *
 * export const db = new KyselyAuth<Database>({
 *   dialect: new PostgresDialect({
 *     pool: new Pool({
 *       host: process.env.DATABASE_HOST,
 *       database: process.env.DATABASE_NAME,
 *       user: process.env.DATABASE_USER,
 *       password: process.env.DATABASE_PASSWORD,
 *     }),
 *   }),
 * })
```
 *
 *
 * :::note
 * An alternative to manually defining types is generating them from the database schema using [kysely-codegen](https://github.com/RobinBlomberg/kysely-codegen), or from Prisma schemas using [prisma-kysely](https://github.com/valtyr/prisma-kysely). When using generated types with `KyselyAuth`, import `Codegen` and pass it as the second generic arg:
 * ```ts
 * import type { Codegen } from "@auth/kysely-adapter"
 * new KyselyAuth<Database, Codegen>(...)
 * ```
 * :::
 * ### Schema
 * ```ts title="db/migrations/001_create_db.ts"
 * import { Kysely, sql } from "kysely"
 *
 * export async function up(db: Kysely<any>): Promise<void> {
 *   await db.schema
 *     .createTable("auth_user")
 *     .addColumn("id", "uuid", (col) =>
 *       col.primaryKey().defaultTo(sql`gen_random_uuid()`)
 *     )
 *     .addColumn("name", "text")
 *     .addColumn("email", "text", (col) => col.unique().notNull())
 *     .addColumn("emailVerified", "timestamptz")
 *     .addColumn("image", "text")
 *     .execute()
 *
 *   await db.schema
 *     .createTable("auth_account")
 *     .addColumn("id", "uuid", (col) =>
 *       col.primaryKey().defaultTo(sql`gen_random_uuid()`)
 *     )
 *     .addColumn("userId", "uuid", (col) =>
 *       col.references("User.id").onDelete("cascade").notNull()
 *     )
 *     .addColumn("type", "text", (col) => col.notNull())
 *     .addColumn("provider", "text", (col) => col.notNull())
 *     .addColumn("providerAccountId", "text", (col) => col.notNull())
 *     .addColumn("refresh_token", "text")
 *     .addColumn("access_token", "text")
 *     .addColumn("expires_at", "bigint")
 *     .addColumn("token_type", "text")
 *     .addColumn("scope", "text")
 *     .addColumn("id_token", "text")
 *     .addColumn("session_state", "text")
 *     .execute()
 *
 *   await db.schema
 *     .createTable("Session")
 *     .addColumn("id", "uuid", (col) =>
 *       col.primaryKey().defaultTo(sql`gen_random_uuid()`)
 *     )
 *     .addColumn("userId", "uuid", (col) =>
 *       col.references("User.id").onDelete("cascade").notNull()
 *     )
 *     .addColumn("sessionToken", "text", (col) => col.notNull().unique())
 *     .addColumn("expires", "timestamptz", (col) => col.notNull())
 *     .execute()
 *
 *   await db.schema
 *     .createTable("VerificationToken")
 *     .addColumn("identifier", "text", (col) => col.notNull())
 *     .addColumn("token", "text", (col) => col.notNull().unique())
 *     .addColumn("expires", "timestamptz", (col) => col.notNull())
 *     .execute()
 *
 *   await db.schema
 *     .createIndex("Account_userId_index")
 *     .on("auth_account")
 *     .column("userId")
 *     .execute()
 *
 *   await db.schema
 *     .createIndex("Session_userId_index")
 *     .on("Session")
 *     .column("userId")
 *     .execute()
 * }
 *
 * export async function down(db: Kysely<any>): Promise<void> {
 *   await db.schema.dropTable("auth_account").ifExists().execute()
 *   await db.schema.dropTable("Session").ifExists().execute()
 *   await db.schema.dropTable("auth_user").ifExists().execute()
 *   await db.schema.dropTable("VerificationToken").ifExists().execute()
 * }
 * ```
 * > This schema is adapted for use in Kysely and is based upon our main [schema](/reference/adapters#models).
 *
 * For more information about creating and running migrations with Kysely, refer to the [Kysely migrations documentation](https://kysely.dev/docs/migrations).
 * 
 * ### Naming conventions
 * If mixed snake_case and camelCase column names is an issue for you and/or your underlying database system, we recommend using Kysely's `CamelCasePlugin` ([see the documentation here](https://kysely-org.github.io/kysely/classes/CamelCasePlugin.html)) feature to change the field names. This won't affect NextAuth.js, but will allow you to have consistent casing when using Kysely.
 */
export function KyselyAdapter(db: Kysely<AuthDb>): Adapter {
  const { adapter } = db.getExecutor()
  const supportsReturning = adapter.supportsReturning
  const isSqlite = adapter instanceof SqliteAdapter

  return {
    async createUser(data) {
      const userData = format.from(data, "emailVerified", isSqlite)
      const query = db.insertInto("auth_user").values(userData)
      const result = supportsReturning
        ? await query.returningAll().executeTakeFirstOrThrow()
        : await query.executeTakeFirstOrThrow().then(async () => {
            return await db
              .selectFrom("auth_user")
              .selectAll()
              .where("email", "=", `${userData.email}`)
              .executeTakeFirstOrThrow()
          })
      return to(result, "emailVerified")
    },
    async getUser(id) {
      const result =
        (await db.selectFrom("auth_user").selectAll().where("id", "=", id).executeTakeFirst()) ??
        null
      if (!result) return null
      return to(result, "emailVerified")
    },
    async getUserByEmail(email) {
      const result =
        (await db
          .selectFrom("auth_user")
          .selectAll()
          .where("email", "=", email)
          .executeTakeFirst()) ?? null
      if (!result) return null
      return to(result, "emailVerified")
    },
    async getUserByAccount({ providerAccountId, provider }) {
      const result =
        (await db
          .selectFrom("auth_user")
          .innerJoin("auth_account", "auth_user.id", "auth_account.userId")
          .selectAll("auth_user")
          .where("auth_account.providerAccountId", "=", providerAccountId)
          .where("auth_account.provider", "=", provider)
          .executeTakeFirst()) ?? null
      if (!result) return null
      return to(result, "emailVerified")
    },
    async updateUser({ id, ...user }) {
      if (!id) throw new Error("User not found")
      const userData = format.from(user, "emailVerified", isSqlite)
      const query = db.updateTable("auth_user").set(userData).where("id", "=", id)
      const result = supportsReturning
        ? await query.returningAll().executeTakeFirstOrThrow()
        : await query.executeTakeFirstOrThrow().then(async () => {
            return await db
              .selectFrom("auth_user")
              .selectAll()
              .where("id", "=", id)
              .executeTakeFirstOrThrow()
          })
      return to(result, "emailVerified")
    },
    async deleteUser(userId) {
      await db.deleteFrom("auth_user").where("auth_user.id", "=", userId).execute()
    },
    async linkAccount(account) {
      await db.insertInto("auth_account").values(account).executeTakeFirstOrThrow()
    },
    async unlinkAccount({ providerAccountId, provider }) {
      await db
        .deleteFrom("auth_account")
        .where("auth_account.providerAccountId", "=", providerAccountId)
        .where("auth_account.provider", "=", provider)
        .executeTakeFirstOrThrow()
    },
    async createSession(data) {
      const sessionData = format.from(data, "expires", isSqlite)
      const query = db.insertInto("auth_session").values(sessionData)
      const result = supportsReturning
        ? await query.returningAll().executeTakeFirstOrThrow()
        : await (async () => {
            await query.executeTakeFirstOrThrow()
            return await db
              .selectFrom("auth_session")
              .selectAll()
              .where("sessionToken", "=", sessionData.sessionToken)
              .executeTakeFirstOrThrow()
          })()
      return to(result, "expires")
    },
    async getSessionAndUser(sessionTokenArg) {
      const result = await db
        .selectFrom("auth_session")
        .innerJoin("auth_user", "auth_user.id", "auth_session.userId")
        .selectAll("auth_user")
        .select([
          "auth_session.id as sessionId",
          "auth_session.userId",
          "auth_session.sessionToken",
          "auth_session.expires",
        ])
        .where("auth_session.sessionToken", "=", sessionTokenArg)
        .executeTakeFirst()
      if (!result) return null
      const { sessionId: id, userId, sessionToken, expires, ...user } = result
      return {
        user: to({ ...user }, "emailVerified"),
        session: to({ id, userId, sessionToken, expires }, "expires"),
      }
    },
    async updateSession(session) {
      const sessionData = format.from(session, "expires", isSqlite)
      const query = db
        .updateTable("auth_session")
        .set(sessionData)
        .where("auth_session.sessionToken", "=", session.sessionToken)
      const result = supportsReturning
        ? await query.returningAll().executeTakeFirstOrThrow()
        : await query.executeTakeFirstOrThrow().then(async () => {
            return await db
              .selectFrom("auth_session")
              .selectAll()
              .where("auth_session.sessionToken", "=", sessionData.sessionToken)
              .executeTakeFirstOrThrow()
          })
      return to(result, "expires")
    },
    async deleteSession(sessionToken) {
      await db
        .deleteFrom("auth_session")
        .where("auth_session.sessionToken", "=", sessionToken)
        .executeTakeFirstOrThrow()
    },
    async createVerificationToken(verificationToken) {
      const verificationTokenData = format.from(verificationToken, "expires", isSqlite)
      const query = db.insertInto("auth_verification_token").values(verificationTokenData)
      const result = supportsReturning
        ? await query.returningAll().executeTakeFirstOrThrow()
        : await query.executeTakeFirstOrThrow().then(async () => {
            return await db
              .selectFrom("auth_verification_token")
              .selectAll()
              .where("token", "=", verificationTokenData.token)
              .executeTakeFirstOrThrow()
          })
      return to(result, "expires")
    },
    async useVerificationToken({ identifier, token }) {
      const query = db
        .deleteFrom("auth_verification_token")
        .where("auth_verification_token.token", "=", token)
        .where("auth_verification_token.identifier", "=", identifier)
      const result = supportsReturning
        ? (await query.returningAll().executeTakeFirst()) ?? null
        : await db
            .selectFrom("auth_verification_token")
            .selectAll()
            .where("token", "=", token)
            .executeTakeFirst()
            .then(async (res) => {
              await query.executeTakeFirst()
              return res
            })
      if (!result) return null
      return to(result, "expires")
    },
  }
}

/**
 * Wrapper over the original `Kysely` class in order to validate the passed in
 * database interface. A regular Kysely instance may also be used, but wrapping
 * it ensures the database interface implements the fields that Auth.js
 * requires. When used with `kysely-codegen`, the `Codegen` type can be passed as
 * the second generic argument. The generated types will be used, and
 * `KyselyAuth` will only verify that the correct fields exist.
 **/
export class KyselyAuth<DB extends T, T = AuthDb> extends Kysely<DB> {}

export type Codegen = {
  [K in keyof AuthDb]: { [J in keyof AuthDb[K]]: unknown }
}
