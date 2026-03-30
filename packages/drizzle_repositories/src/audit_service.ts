import { type AuditLogEntityType, type AuditLogEventType, type JsonSerializable } from "./utils.js"

export type AuditUser = { id: string }

export type AuditLogRepositoryLike = {
  log(entry: {
    event_type: AuditLogEventType
    entity_type: AuditLogEntityType
    entity_id?: string
    user_id: string
    details?: JsonSerializable
    parent_id?: string
    is_system_event?: number
  }): Promise<void>
}

export class AuditService {
  private auditLogRepository: AuditLogRepositoryLike
  private user?: AuditUser | null
  private parentId?: string

  constructor(
    auditLogRepository: AuditLogRepositoryLike,
    user?: AuditUser | null,
    parentId?: string,
  ) {
    this.auditLogRepository = auditLogRepository
    this.user = user
    this.parentId = parentId
  }

  setUser(user: AuditUser | null | undefined): void {
    this.user = user
  }

  setParentId(parentId: string | undefined): void {
    this.parentId = parentId
  }

  async logEntityCreate(
    entityType: AuditLogEntityType,
    entityId: string,
    data: JsonSerializable,
  ): Promise<void> {
    await this.logEvent("CREATE", entityType, entityId, { new_data: data })
  }

  async logEntityUpdate(
    entityType: AuditLogEntityType,
    entityId: string,
    oldData: JsonSerializable,
    newData: JsonSerializable,
  ): Promise<void> {
    await this.logEvent("UPDATE", entityType, entityId, {
      old_data: oldData,
      new_data: newData,
    })
  }

  async logEntityDelete(
    entityType: AuditLogEntityType,
    entityId: string,
    data: JsonSerializable,
  ): Promise<void> {
    await this.logEvent("DELETE", entityType, entityId, { deleted_data: data })
  }

  async logSystemEvent(
    eventType: AuditLogEventType,
    details?: JsonSerializable,
  ): Promise<void> {
    await this.logEvent(eventType, "system", undefined, details, true)
  }

  async logWithUser(
    eventType: AuditLogEventType,
    entityType: AuditLogEntityType,
    entityId: string | undefined,
    userId: string,
    details?: JsonSerializable,
    isSystemEvent = false,
  ): Promise<void> {
    try {
      await this.auditLogRepository.log({
        event_type: eventType,
        entity_type: entityType,
        entity_id: entityId,
        user_id: userId,
        details,
        parent_id: this.parentId,
        is_system_event: isSystemEvent ? 1 : 0,
      })
    } catch (error) {
      console.error("Failed to log audit event:", error)
    }
  }

  private async logEvent(
    eventType: AuditLogEventType,
    entityType: AuditLogEntityType,
    entityId?: string,
    details?: JsonSerializable,
    isSystemEvent = false,
  ): Promise<void> {
    try {
      await this.auditLogRepository.log({
        event_type: eventType,
        entity_type: entityType,
        entity_id: entityId,
        user_id: this.user?.id || "system",
        details,
        parent_id: this.parentId,
        is_system_event: isSystemEvent ? 1 : 0,
      })
    } catch (error) {
      console.error("Failed to log audit event:", error)
    }
  }
}
