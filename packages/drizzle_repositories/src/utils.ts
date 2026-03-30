export type AuditLogEntityType = string
export type AuditLogEventType = string

export type JsonSerializable = Record<string, unknown>

export interface AuditContext {
  user?: { id: string } | null
  request?: Request
  skipAudit?: boolean
}

export interface AuditLogEntry {
  event_type: AuditLogEventType
  entity_type: AuditLogEntityType
  entity_id?: string
  table_name?: string
  parent_id?: string
  user_id: string
  details?: JsonSerializable
  ip_address?: string
  user_agent?: string
  is_system_event?: number
}
