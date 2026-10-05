import { d1AuditLogTable } from "@willyim/kit/audit/d1"
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
    // IdP-management permissions (what this principal may do *to the app in the
    // IdP*). Distinct from productPermissions below.
    permissions: text("permissions", { mode: "json" }).$type<string[]>().default([]),
    // The app's own product permissions, granted from the catalog the app
    // declares in its metadata. Emitted downstream in the id_token; the app
    // enforces them. Admins resolve to the full declared catalog.
    productPermissions: text("product_permissions", { mode: "json" }).$type<string[]>().default([]),
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
    // Product-permission grants carried to the application_member row on accept.
    productPermissions: text("product_permissions", { mode: "json" }).$type<string[]>().default([]),
    // Unguessable token for the branded accept link. Not the security boundary;
    // conversion is by verified-email match, the token only picks the landing UX.
    token: text("token").notNull(),
    invitedByUserId: text("invited_by_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    expiresAt: integer("expires_at", { mode: "timestamp" }).notNull(),
    createdAt: integer("created_at", { mode: "timestamp" })
      .$defaultFn(() => new Date())
      .notNull(),
  },
  // At most one live invite per app + email.
  (t) => [
    uniqueIndex("application_invitation_token_unique").on(t.token),
    uniqueIndex("application_invitation_app_email_uidx").on(t.applicationId, t.email),
  ],
)

export type ApplicationInvitation = typeof applicationInvitation.$inferSelect

/**
 * Management API key: a hashed, revocable, optionally-expiring credential that
 * lets an agent or service drive the management API. The plaintext token is
 * shown once at creation and never stored — only its SHA-256 hash and a
 * non-secret prefix (for identification in the UI) are persisted.
 *
 * A row with an `application_id` is *scoped*: one application, an explicit
 * permission set. A row with a NULL `application_id` is an IdP-level **admin
 * key** — every permission on every app, and a distinct identity in the audit
 * log. Admin keys are the only superadmin credential there is; break-glass
 * recovery is to insert one such row by hand (see the client README).
 */
export const apiKey = sqliteTable(
  "api_key",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    // The app this key administers — matches oauth_client.metadata.app and the
    // applicationId workspaces/members are scoped by.
    //
    // NULL means the key is *IdP-level*: a named superadmin key with every
    // permission on every app. The nullability of the scope is the kind — a
    // separate `kind` column could disagree with the scope, this cannot.
    applicationId: text("application_id"),
    name: text("name").notNull(),
    // First chars of the token (e.g. "wim_a1b2c3d4"), shown so a key is
    // identifiable in the UI. Not a secret.
    prefix: text("prefix").notNull(),
    // SHA-256 (hex) of the full token. The lookup key on every request.
    keyHash: text("key_hash").notNull(),
    // Granted IdP-management permissions (subset of APP_PERMISSIONS).
    permissions: text("permissions", { mode: "json" }).$type<string[]>().default([]),
    // The human whose authority the key carries: who minted it, or — for a key
    // minted by another key — that key's human, inherited down the chain.
    createdByUserId: text("created_by_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    // A human is behind this key (directly or through its parent key). Kept
    // apart from created_by_user_id because that column is nulled when the
    // user is deleted: true with a null creator means "creator deleted", which
    // the resolver refuses, not "machine-minted".
    mintedByHuman: integer("minted_by_human", { mode: "boolean" }).notNull().default(false),
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
  (t) => [
    uniqueIndex("api_key_key_hash_unique").on(t.keyHash),
    index("api_key_app_idx").on(t.applicationId),
  ],
)

export type ApiKey = typeof apiKey.$inferSelect

/**
 * User API key: a credential an *app's end user* creates to call that app's own
 * API (e.g. an invoices API token). The IdP centralizes minting and validation
 * so consumer apps don't each grow their own key store: the app mints/validates
 * via the management API (authenticated with its scoped `wim_` key), shows the
 * plaintext to the user once, and never stores it. Distinct from `api_key`,
 * which administers the IdP itself. Scopes come from the app's declared product
 * permission catalog; the app enforces them.
 */
export const userApiKey = sqliteTable(
  "user_api_key",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    // The app whose API this key calls — oauth_client.metadata.app.
    applicationId: text("application_id").notNull(),
    // The end user who owns the key.
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    // Optional tenant binding (organization.id) for workspace-scoped keys.
    workspaceId: text("workspace_id"),
    name: text("name").notNull(),
    // First chars of the token (e.g. "wak_a1b2c3d4") for identification. Not secret.
    prefix: text("prefix").notNull(),
    // SHA-256 (hex) of the full token — the lookup key on validation.
    keyHash: text("key_hash").notNull(),
    // Granted scopes, a subset of the app's product permission catalog.
    scopes: text("scopes", { mode: "json" }).$type<string[]>().default([]),
    lastUsedAt: integer("last_used_at", { mode: "timestamp" }),
    // Null = never expires.
    expiresAt: integer("expires_at", { mode: "timestamp" }),
    // Set on revoke; kept (not deleted) for UI visibility + audit history.
    revokedAt: integer("revoked_at", { mode: "timestamp" }),
    createdAt: integer("created_at", { mode: "timestamp" })
      .$defaultFn(() => new Date())
      .notNull(),
  },
  (t) => [
    uniqueIndex("user_api_key_key_hash_unique").on(t.keyHash),
    index("user_api_key_app_idx").on(t.applicationId),
    index("user_api_key_app_user_idx").on(t.applicationId, t.userId),
  ],
)

export type UserApiKey = typeof userApiKey.$inferSelect

/**
 * App token: a short-lived credential for ONE app's API, minted by an IdP
 * superadmin. GitHub-App style — an admin key (`wim_`) is the private key and
 * never goes to an app; this (`wat_`) is the installation token that does. The
 * app validates it through the same endpoint as a `wak_` user key and treats it
 * as the issuer acting in the app, with `scopes` (`["*"]` unless narrowed).
 *
 * Exactly one issuer column is set: the admin key that minted it, or the
 * allowlisted admin who did from a session. A token is only as good as its
 * issuer — once that key is revoked or expired, or that email leaves
 * ADMIN_EMAILS, the token stops validating. No revoke of its own: it expires
 * within the hour.
 */
export const appToken = sqliteTable(
  "app_token",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    // The app whose API this token calls — oauth_client.metadata.app.
    applicationId: text("application_id").notNull(),
    // First chars of the token (e.g. "wat_a1b2c3d4") for identification. Not secret.
    prefix: text("prefix").notNull(),
    // SHA-256 (hex) of the full token — the lookup key on validation.
    keyHash: text("key_hash").notNull(),
    // `["*"]`, or scopes resolved against the app's catalog at mint.
    scopes: text("scopes", { mode: "json" }).$type<string[]>().notNull(),
    // Optional tenant binding (organization.id). Null = any workspace.
    workspaceId: text("workspace_id"),
    issuedByKeyId: text("issued_by_key_id").references(() => apiKey.id, {
      onDelete: "set null",
    }),
    issuedByUserId: text("issued_by_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    createdAt: integer("created_at", { mode: "timestamp" })
      .$defaultFn(() => new Date())
      .notNull(),
    expiresAt: integer("expires_at", { mode: "timestamp" }).notNull(),
  },
  (t) => [uniqueIndex("app_token_key_hash_unique").on(t.keyHash)],
)

export type AppToken = typeof appToken.$inferSelect

/**
 * A user's identity on some OTHER system — their Slack user id, their WhatsApp
 * number, a Telegram id — pinned to their IdP user, so an app that hears from
 * them on that system can ask "who is this, and what may they do here?" and
 * get the same answer every other surface gets.
 *
 * Global, not per app: a Slack id identifies a person regardless of which app
 * is asking. What IS per app is the answer to the second half of the question,
 * which is why the resolve endpoint is app-scoped and the link endpoints are
 * not. The (provider, external_id) pair is unique — one Slack account cannot
 * belong to two people — but one person may hold many.
 *
 * Linking is a superadmin act. It asserts "this external account IS this
 * person" with nothing to prove it, so it must never be self-serve or
 * app-driven: an app that could link identities could grant itself anyone.
 */
export const linkedIdentity = sqliteTable(
  "linked_identity",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    // The system the id belongs to — "slack", "whatsapp", "telegram". Lowercase
    // by convention; the service normalises.
    provider: text("provider").notNull(),
    // The id AS THAT SYSTEM SPELLS IT. A Slack member id is "U0AAE7LAATD"; a
    // WhatsApp identity is the E.164 number. Never transformed, so a lookup
    // from the system's own event is an exact match.
    externalId: text("external_id").notNull(),
    // A human label ("willy's phone"), for the console. Optional.
    label: text("label"),
    createdAt: integer("created_at", { mode: "timestamp" })
      .$defaultFn(() => new Date())
      .notNull(),
  },
  (t) => [
    uniqueIndex("linked_identity_provider_external_uidx").on(t.provider, t.externalId),
    index("linked_identity_user_idx").on(t.userId),
  ],
)

export type LinkedIdentity = typeof linkedIdentity.$inferSelect

/**
 * Audit trail for privileged actions (member/key/workspace/app writes,
 * impersonation): kit's audit table, with two context columns. application_id
 * scopes a row to one app (an app reads only its own trail); actor names the
 * principal ("user:<id>", "adminkey:<id>", "apikey:<id>"), since machine
 * callers have no user_id. Written through `ctx.audit` (`auditTrail`, lib/audit.server.ts).
 */
export const auditLog = d1AuditLogTable({
  contextColumns: [{ column: "application_id" }, { column: "actor", index: false }],
})

export type AuditLog = typeof auditLog.$inferSelect
