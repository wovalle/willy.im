import z from "zod"

import { endpoint } from "next-better-api"
import { intentParser } from "./intentParser"
import { toUtc } from "./lib/dateUtils"
import { directus } from "./lib/directus"
import { sendMessage } from "./lib/telegram"
import { Intent } from "./types"
import { TelegramUpdateSchema } from "./zodSchemas"

export const handleTelegramMessage = endpoint(
  {
    method: "post",
    bodySchema: z.object(TelegramUpdateSchema.shape),
    responseSchema: z.object({
      ok: z.boolean(),
    }),
  },
  async ({ body }) => {
    const message = body.message

    if (!message || !message.text) {
      return { body: { ok: false } }
    }

    // If user is not registered, ask them to do so
    const user = await directus.getUser(message.from.id.toString())

    if (!user) {
      await sendMessage({
        text: "{{butler.replies.user_not_found}}",
        chatId: message.from.id,
        replyTo: message.message_id,
      })

      return {
        body: {
          ok: true,
          intent: { type: "Unknown" },
        },
      }
    }

    // If this is the user first message, just tell the instructions
    if (message.text === "/start") {
      await sendMessage({
        text: "{{butler.replies.greetings}}",
        chatId: message.from.id,
        replyTo: message.message_id,
      })

      const intent: Intent = {
        type: "Unknown",
        rawText: message.text,
      }

      await directus.saveMessage({
        from: message.from.id.toString(),
        text: message.text,
        body: JSON.stringify(body, null, 2),
        response: JSON.stringify(intent, null, 2),
      })

      return {
        body: {
          ok: true,
          intent,
        },
      }
    }

    const intent = intentParser(message.text, {
      currentDate: toUtc(new Date()),
      tz: "Etc/UTC",
    })

    switch (intent.type) {
      case "Reminder.GetAll": {
        await sendMessage({
          text: "{{butler.replies.reminders.get_all}}",
          chatId: message.from.id,
          replyTo: message.message_id,
        })
        break
      }

      case "Reminder.Schedule": {
        const { text, date } = intent.reminder

        await directus.saveReminder(text, date, user.id)

        await sendMessage({
          text: "{{butler.replies.ack}}",
          chatId: message.from.id,
          replyTo: message.message_id,
        })
        break
      }

      case "Message.Reply": {
        await sendMessage({
          text: intent.text,
          chatId: message.from.id,
          replyTo: message.message_id,
        })
        break
      }

      default: {
        // TODO: reply fallback, see willy.im/butler for instructions
        await sendMessage({
          text: "{{butler.replies.fallback}}",
          chatId: message.from.id,
          replyTo: message.message_id,
        })
      }
    }

    await directus.saveMessage({
      from: message.from.id.toString(),
      text: message.text,
      body: JSON.stringify(body, null, 2),
      response: JSON.stringify(intent, null, 2),
    })

    return {
      body: {
        ok: true,
        intent,
      },
    }
  }
)
