import {
  BackendAdapter,
  SaveCustomEventDataInput,
  SaveCustomEventInput,
  SavePageViewInput,
  Session,
} from "@luchyio/next"

import crypto from "crypto"

export const MockAdapter: BackendAdapter = {
  upsertSession: async (session: Omit<Session, "createdAt">): Promise<string> => {
    const randomUUID = crypto.randomUUID()
    console.log("Session", { session })
    return randomUUID
  },
  // TODO: will be replaced with a generic method
  getPageViews: async (url: string): Promise<number> => {
    console.log("Session", { url })
    return 42
  },
  savePageView: async (pageViewInputParams: SavePageViewInput): Promise<string> => {
    const randomUUID = crypto.randomUUID()
    console.log({ pageViewInputParams })
    return randomUUID
  },
  saveEvent: async (eventInput: SaveCustomEventInput): Promise<string> => {
    const randomUUID = crypto.randomUUID()
    console.log({ eventInput })
    return randomUUID
  },
  saveEventData: async (eventDataInput: SaveCustomEventDataInput): Promise<string> => {
    const randomUUID = crypto.randomUUID()
    console.log({ eventDataInput })
    return randomUUID
  },
}
