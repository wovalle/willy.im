import {
  BackendAdapter,
  SaveCustomEventDataInput,
  SaveCustomEventInput,
  SavePageViewInput,
  Session,
} from "@luchyio/core"
import { prisma, Prisma } from "@willyim/db"

// TODO: API to execute multiple operations in one transaction
export const PrismaAdapter: BackendAdapter = {
  upsertSession: async (session: Omit<Session, "createdAt">): Promise<string> => {
    const { id } = await prisma.session.upsert({
      create: session,
      where: {
        id: session.id,
      },
      update: {},
      select: {
        id: true,
      },
    })

    return id
  },
  // TODO: will be replaced with generic method
  getPageViews: async (url: string): Promise<number> => {
    return prisma.pageView.count({
      where: {
        url,
      },
    })
  },
  savePageView: async (pageViewInputParams: SavePageViewInput): Promise<string> => {
    const pageView = await prisma.pageView.create({
      data: {
        url: pageViewInputParams.url,
        session_id: pageViewInputParams.sessionId,
      },
      select: {
        id: true,
      },
    })

    return pageView.id
  },
  saveEvent: async (eventInput: SaveCustomEventInput): Promise<string> => {
    const event = await prisma.event.create({
      data: {
        type: eventInput.type,
        url: eventInput.url,
        session_id: eventInput.sessionId,
      },
    })

    return event.id
  },
  saveEventData: async (eventDataInput: SaveCustomEventDataInput): Promise<string> => {
    const eventData = await prisma.eventData.create({
      data: {
        event_id: eventDataInput.eventId,
        event_data: eventDataInput.data as Prisma.JsonObject,
      },
    })

    return eventData.id
  },
}
