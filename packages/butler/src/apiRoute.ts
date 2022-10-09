import type { NextApiRequest, NextApiResponse } from "next"
import type { Update } from "typegram"
import packageInfo from "../package.json"
import { toUtc } from "./lib/dateUtils"

import { intentParser } from "./intentParser"

export const nextApiHandler = () => {
  return async (req: NextApiRequest & { body: unknown }, res: NextApiResponse) => {
    const { path } = req.query
    const flatPath = Array.isArray(path) ? `/${path.join("/")}` : path

    switch (flatPath) {
      case "/channels/telegram": {
        if (req.method !== "POST") {
          return res.status(405).json({ message: "Method not allowed" })
        }

        // Check secret token

        const body = req.body as Update
        const message = "message" in body && "text" in body.message ? body.message : null

        if (!message) {
          // probably another update that I don't care atm
          return res.status(200).json({ wront: true })
        }

        const intent = intentParser(message.text, {
          currentDate: toUtc(new Date()),
          tz: "Etc/UTC",
        })

        return res.status(200).json({ online: true, version: packageInfo.version, result: intent })
      }

      default: {
        return res.status(404).json({ error: "invalid path" })
      }
    }
  }
}
