import { sql } from "drizzle-orm"
import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core"

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
 * Scoped API key: a hashed, revocable, optionally-expiring credential that lets
 * an agent or service drive the management API for *one application* with a
 * specific permission set. Replaces the single global ADMIN_API_TOKEN (which
 * stays as the superadmin escape hatch). The plaintext token is shown once at
 * creation and never stored — only its SHA-256 hash and a non-secret prefix
 * (for identification in the UI) are persisted.
 */
export const apiKey = sqliteTable(
  "api_key",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    // The app this key administers — matches oauth_client.metadata.app and the
    // applicationId workspaces/members are scoped by.
    applicationId: text("application_id").notNull(),
    name: text("name").notNull(),
    // First chars of the token (e.g. "wim_a1b2c3d4"), shown so a key is
    // identifiable in the UI. Not a secret.
    prefix: text("prefix").notNull(),
    // SHA-256 (hex) of the full token. The lookup key on every request.
    keyHash: text("key_hash").notNull().unique(),
    // Granted IdP-management permissions (subset of APP_PERMISSIONS).
    permissions: text("permissions", { mode: "json" }).$type<string[]>().default([]),
    createdByUserId: text("created_by_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    lastUsedAt: integer("last_used_at", { mode: "timestamp" }),
    // Null = never expires.
    expiresAt: integer("expires_at", { mode: "timestamp" }),
    // Set on revoke; a revoked key authenticates no further. Kept (not deleted)
    // so the key stays visible in the UI and for audit history.
    revokedAt: integer("revoked_at", { mode: "timestamp" }),
    createdAt: integer("created_at", { mode: "timestamp" })
      .$defaultFn(() => new Date())
      .notNull(),
  },
  (t) => [index("api_key_app_idx").on(t.applicationId)],
)

export type ApiKey = typeof apiKey.$inferSelect

/**
 * Audit trail for privileged actions (member/key/workspace/app writes,
 * impersonation). Mirrors the D1 `audit_logs` shape from @willyim/drizzle-audit
 * (so it can be swapped to that package once it's a workspace dependency — same
 * way permissions.ts mirrors @willyim/rbac), with two added columns we always
 * want: application_id (scope — lets an app read only its own trail) and actor
 * (a human-readable principal descriptor, since machine callers have no user_id).
 */
export const auditLog = sqliteTable(
  "audit_logs",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    // The entity type touched, e.g. "api_key", "application_member", "organization".
    tableName: text("table_name").notNull(),
    // "create" | "update" | "delete" | "revoke" | "invite" | "impersonate" | …
    operation: text("operation").notNull(),
    // The affected entity's id (key id, user id, workspace id, …).
    rowId: text("row_id"),
    applicationId: text("application_id"),
    // The human actor's user id when there is one; null for machine callers.
    userId: text("user_id"),
    // Principal descriptor: "user:<id>" | "apikey:<id>" | "superadmin-token".
    actor: text("actor"),
    oldData: text("old_data", { mode: "json" }),
    newData: text("new_data", { mode: "json" }),
    createdAt: text("created_at")
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (t) => [
    index("audit_logs_application_id_idx").on(t.applicationId),
    index("audit_logs_table_name_idx").on(t.tableName),
    index("audit_logs_created_at_idx").on(t.createdAt),
  ],
)

export type AuditLog = typeof auditLog.$inferSelect

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
