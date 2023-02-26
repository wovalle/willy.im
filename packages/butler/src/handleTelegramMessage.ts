import z from "zod"

import { endpoint } from "next-better-api"
import { intentParser } from "./intentParser"
import { toUtc } from "./lib/dateUtils"
import { directus } from "./lib/directus"
import { sendMessage } from "./lib/telegram"
import { TelegramUpdateSchema } from "./zodSchemas"

export const handler = endpoint(
  {
    method: "post",
    bodySchema: z.object(TelegramUpdateSchema.shape),
    responseSchema: z.object({
      ok: z.boolean(),
    }),
  },
  async ({ body }) => {
    const message = body.message
    const telegramChat = message?.chat

    if (!message || !message.text || !message.text.trim() || !telegramChat) {
      return { body: { ok: false } }
    }

    const chatId = telegramChat.id.toString()
    let chat = await directus.getChat(chatId)

    if (!chat) {
      await directus.saveChat({
        id: chatId,
        platform: "telegram",
        type: message.chat?.type === "private" ? "individual" : "group",
      })

      chat = await directus.getChat(chatId)
    }

    const intent = intentParser(message.text, {
      currentDate: toUtc(new Date()),
      tz: "Etc/UTC",
    })

    switch (intent.type) {
      case "InitialMessage": {
        await sendMessage({
          text: "{{butler.replies.greetings}}",
          chatId: message.from.id,
          replyTo: message.message_id,
        })
        break
      }
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

        await directus.saveReminder({
          text,
          date,
          chatId: message.chat?.id.toString(),
          messageId: message.message_id.toString(),
        })

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
