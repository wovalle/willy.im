import { extractActivators } from "./lib/extractActivators"
import { extractDate } from "./lib/extractDates"
import { DateParserOpts, Intent } from "./types"

export const intentParser = (rawMessageText: string, opts: DateParserOpts): Intent => {
  // TODO: Make parsers factory
  const parsedDate = extractDate(rawMessageText, opts)
  const parsedActivator = extractActivators(rawMessageText)
  const reminderText = rawMessageText
    .replace(parsedDate.trigger ?? "", "")
    .replace(parsedActivator.trigger ?? "", "")
    .trim()

  if (rawMessageText === "/start") {
    return {
      type: "InitialMessage",
    }
  } else if (parsedDate.trigger && parsedDate.date > opts.currentDate) {
    return {
      type: "Reminder.Schedule",
      reminder: {
        activator: parsedActivator.trigger ?? "",
        date: parsedDate.date,
        text: reminderText,
        rawText: rawMessageText,
      },
    }
  } else if (parsedDate.trigger && parsedDate.date < opts.currentDate) {
    return {
      type: "Message.Reply",
      text: "{{butler.errors.reminders.past_date}}",
    }
  }

  return {
    type: "Unknown",
    rawText: rawMessageText,
  }
}
