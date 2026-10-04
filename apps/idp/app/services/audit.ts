import { declareService, method } from "@willyim/kit"

import { listAuditForApp } from "../lib/audit.server"
import { io } from "./io"

/** The app's audit trail: who did what to its members, keys, workspaces and registration. */
export const audit = declareService((ctx) => ({
  list: method(
    {
      summary: "List the app's recent audit entries, newest first",
      permission: "audit:read",
      hints: { readOnly: true },
      ...io("audit.list"),
    },
    async ({ limit }) => ({ entries: await listAuditForApp(ctx, ctx.app, limit) }),
  ),
}))
