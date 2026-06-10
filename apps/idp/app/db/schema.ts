import { integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core"

// Better Auth tables (user / session / account / verification / passkey / org / oauth).
// Generated from scripts/auth.gen.ts via `npm run auth:db:generate`.
export * from "./auth-schema"
import { user } from "./auth-schema"

/**
 * App-level membership: who can administer or use an application *in the IdP*.
 * applicationId is the app key (oauth_client.metadata.app), the same identifier
 * workspaces are scoped by. admin = all management permissions for the app;
 * member = the explicit permissions list (from the app's catalog).
 */
export const applicationMember = sqliteTable(
  "application_member",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    applicationId: text("application_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    role: text("role", { enum: ["admin", "member"] }).notNull().default("member"),
    permissions: text("permissions", { mode: "json" }).$type<string[]>().default([]),
    createdAt: integer("created_at", { mode: "timestamp" })
      .$defaultFn(() => new Date())
      .notNull(),
  },
  (t) => [uniqueIndex("application_member_app_user_uidx").on(t.applicationId, t.userId)],
)

export type ApplicationMember = typeof applicationMember.$inferSelect

/**
 * A pending invitation to become an app member. Only ever holds *pending*
 * invites: the row is created when an email with no willy.im account is invited,
 * and deleted once the invite is accepted (the application_member row becomes
 * the record of truth) or revoked. Existing users are added directly to
 * application_member and never get a row here. Conversion happens on the
 * invitee's first sign-in, matched by their verified email.
 */
export const applicationInvitation = sqliteTable(
  "application_invitation",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    applicationId: text("application_id").notNull(),
    // Normalized (lowercase + trimmed) — the join key to a future user.
    email: text("email").notNull(),
    role: text("role", { enum: ["admin", "member"] }).notNull().default("member"),
    permissions: text("permissions", { mode: "json" }).$type<string[]>().default([]),
    // Unguessable token for the branded accept link. Not the security boundary;
    // conversion is by verified-email match, the token only picks the landing UX.
    token: text("token").notNull().unique(),
    invitedByUserId: text("invited_by_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    expiresAt: integer("expires_at", { mode: "timestamp" }).notNull(),
    createdAt: integer("created_at", { mode: "timestamp" })
      .$defaultFn(() => new Date())
      .notNull(),
  },
  // At most one live invite per app + email.
  (t) => [uniqueIndex("application_invitation_app_email_uidx").on(t.applicationId, t.email)],
)

export type ApplicationInvitation = typeof applicationInvitation.$inferSelect

/** Per-app, free-form user metadata (self-service profile fields an app cares about). */
export const userAppMetadata = sqliteTable(
  "user_app_metadata",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    applicationId: text("application_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    data: text("data", { mode: "json" }).$type<Record<string, unknown>>().default({}),
    updatedAt: integer("updated_at", { mode: "timestamp" })
      .$defaultFn(() => new Date())
      .notNull(),
  },
  (t) => [uniqueIndex("user_app_metadata_app_user_uidx").on(t.applicationId, t.userId)],
)

/**
 * Placeholder app table from Phase 1. Kept for the migration history.
 */
export const appMeta = sqliteTable("app_meta", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" })
    .$defaultFn(() => new Date())
    .notNull(),
})
