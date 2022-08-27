import { intentParser } from "./intentParser"
import { toUtc } from "./lib/dateUtils"
import { DateParserOpts } from "./types"

const dateParserOpts: DateParserOpts = {
  currentDate: toUtc("2022-08-08T08:00:00.000Z"),
  tz: "UTC",
}

describe("intentParser", () => {
  describe("when message intent is to schedule reminder in the future", () => {
    it("should return a valid ScheduleReminderIntent", () => {
      const message = "remind me to listen to porcupine tree in two hours"

      expect(intentParser(message, dateParserOpts)).toEqual({
        type: "Reminder.Schedule",
        reminder: {
          activator: "remind me to",
          date: toUtc("2022-08-08T10:00:00.000Z"),
          rawText: message,
          text: "listen to porcupine tree",
        },
      })
    })
  })

  describe("when message intent is to schedule reminder in the past", () => {
    it("should return a message with the errore", () => {
      const message = "remind me to listen to porcupine tree yesterday"

      expect(intentParser(message, dateParserOpts)).toEqual({
        type: "Message.Reply",
        text: "{{error.reminder.pastDate}}",
      })
    })
  })

  describe("when message intent is to get all reminders", () => {
    it.todo("should return a valid GetAllRemindersIntent")
  })

  describe("when message intent is unknown", () => {
    it("should return UnknownIntent", () => {
      const message = "matanga dijo la changa"

      expect(intentParser(message, dateParserOpts)).toEqual({
        type: "Unknown",
        rawText: message,
      })
    })
  })
})
