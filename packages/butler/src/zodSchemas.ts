import { z } from "zod"

export const TelegramChatSchema = z.object({
  id: z.number(),
  type: z.enum(["private", "group", "supergroup", "channel"]),
  title: z.string().optional(),
  first_name: z.string().optional(),
  last_name: z.string().optional(),
  username: z.string().optional(),
})

export const TelegramUserSchema = z.object({
  id: z.number(),
  is_bot: z.boolean(),
  first_name: z.string(),
  last_name: z.string(),
  username: z.string(),
  language_code: z.string(),
})

export const TelegramMessageEntity = z.object({
  type: z.enum([
    "mention",
    "hashtag",
    "cashtag",
    "bot_command",
    "url",
    "email",
    "phone_number",
    "bold",
    "bold",
    "italic",
    "underline",
    "strikethrough",
    "spoiler",
    "code",
    "pre",
    "text_link",
    "text_mention",
    "custom_emoji",
  ]),
  offset: z.number(),
  length: z.number(),
  url: z.string().optional(),
  user: z.object(TelegramUserSchema.shape).optional(),
  language: z.string().optional(),
  custom_emoji_id: z.string().optional(),
})

export const TelegramMessageSchema = z.object({
  message_id: z.number(),
  from: z.object(TelegramUserSchema.shape),
  date: z.number(),
  chat: z.object(TelegramChatSchema.shape).optional(),
  text: z.string().optional(),
  entities: z.array(z.object(TelegramMessageEntity.shape)).optional(),
  edit_date: z.number().optional(),
})

export const TelegramUpdateSchema = z.object({
  message: z.object(TelegramMessageSchema.shape).optional(),
  edited_message: z.object(TelegramMessageSchema.shape).optional(),
})
