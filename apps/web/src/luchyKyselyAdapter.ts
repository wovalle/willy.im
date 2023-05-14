import {
  BackendAdapter,
  SaveCustomEventDataInput,
  SaveCustomEventInput,
  SavePageViewInput,
  Session,
} from "@luchyio/next"
import { db } from "../db/kysely"

// TODO: API to execute multiple operations in one transaction
export const KyselyAdapter: BackendAdapter = {
  upsertSession: async (session: Omit<Session, "createdAt">): Promise<string> => {
    await db
      .insertInto("sessions")
      .values({
        id: session.id,
        browser: session.browser ?? undefined,
        os: session.os ?? undefined,
        language: session.language ?? undefined,
        country: session.country ?? undefined,
        device: session.device ?? undefined,
      })
      .onConflict((oc) => oc.column("id").doNothing())
      .returning("id")
      .executeTakeFirst()

    return session.id
  },
  // TODO: will be replaced with generic method
  getPageViews: async (url: string): Promise<number> => {
    throw new Error("Not implemented")
  },
  savePageView: async (pageViewInputParams: SavePageViewInput): Promise<string> => {
    const view = await db
      .insertInto("pageviews")
      .values({
        session_id: pageViewInputParams.sessionId,
        url: pageViewInputParams.url,
        origin: pageViewInputParams.origin,
        raw: JSON.stringify(pageViewInputParams.raw ?? {}),
      })
      .returning("id")
      .executeTakeFirstOrThrow()

    if (!view) {
      throw new Error("Failed to save pageview")
    }

    return view.id.toString()
  },
  saveEvent: async (eventInput: SaveCustomEventInput): Promise<string> => {
    const event = await db
      .insertInto("events")
      .values({
        type: eventInput.type,
        url: eventInput.url,
        session_id: eventInput.sessionId,
        origin: eventInput.origin,
        raw: JSON.stringify(eventInput.raw ?? {}),
      })
      .returning("id")
      .executeTakeFirstOrThrow()

    return event.id.toString()
  },
  saveEventData: async (eventDataInput: SaveCustomEventDataInput): Promise<string> => {
    const eventData = await db

      .insertInto("event_data")
      .values({
        event_id: parseInt(eventDataInput.eventId),
        event_data: JSON.stringify(eventDataInput.data ?? {}),
      })
      .returning("id")
      .executeTakeFirstOrThrow()

    return eventData.id.toString()
  },
}
