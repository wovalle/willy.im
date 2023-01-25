// Entities
export type Reminder = {
  activator: string
  text: string
  date: Date
  rawText: string
}

// Intents
export type ScheduleReminderIntent = {
  type: "Reminder.Schedule"
  reminder: Reminder
}

export type ReminderGetAllIntent = {
  type: "Reminder.GetAll"
  reminders: Reminder[]
}

export type UnknownIntent = {
  type: "Unknown"
  rawText: string
}

export type SendMessageIntent = {
  type: "Message.Reply"
  text: string
}

export type Intent =
  | ScheduleReminderIntent
  | ReminderGetAllIntent
  | SendMessageIntent
  | UnknownIntent

// Data Extractors
export type IFailedExtractor = {
  trigger: null
  from: number
  to: number
}

export type IBaseExtractor = {
  trigger: string
  from: number
  to: number
}

type DeepNullable<T> = {
  [K in keyof T]: DeepNullable<T[K]> | null
}

export type ICustomExtractor<T = {}> = (IBaseExtractor & T) | (IFailedExtractor & DeepNullable<T>)

// Other types
export type DateParserOpts = {
  currentDate: Date
  tz: string
}
