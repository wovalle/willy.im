import { z } from "zod"

export type AuditLogFilters = {
  search?: string
  entities?: string[]
  actions?: string[]
}

export const auditLogSearchParamsSchema = z.object({
  page: z.coerce.number().int().min(1).optional().default(1),
  pageSize: z.coerce.number().int().positive().max(100).optional().default(10),
  search: z.string().optional().default(""),
  entities: z.array(z.string()).optional().default([]),
  actions: z.array(z.string()).optional().default([]),
})

export type AuditLogSearchParams = z.infer<typeof auditLogSearchParamsSchema>
