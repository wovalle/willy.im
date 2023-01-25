import { ParsingResult } from "chrono-node/dist/results"
import { toUtc } from "./dateUtils"
import { extractDate } from "./extractDates"

describe("extractDates", () => {
  const currentDate = toUtc("2022-08-08T08:00:00.000Z")
  const tz = "UTC"

  const scenarios = [
    ["take the thrash this tuesday", toUtc("2022-08-09T09:00:00.000Z")],
    ["take the thrash this tuesday at 8pm", toUtc("2022-08-09T20:00:00.000Z")],
    ["take the thrash next monday", toUtc("2022-08-15T09:00:00.000Z")],
    ["remind me something in one hour in two hours", toUtc("2022-08-08T10:00:00.000Z")],
    ["remind me to take out the thrash in one hour", toUtc("2022-08-08T09:00:00.000Z")],
    ["rm take out the thrash tomorrow", toUtc("2022-08-09T09:00:00.000Z")],
    ["rm to take out the thrash at 15:40", toUtc("2022-08-08T15:40:00.000Z")],
    ["take out the thrash at 3:15pm", toUtc("2022-08-08T15:15:00.000Z")],
    ["rm take out thrash on Monday at 6am", toUtc("2022-08-15T06:00:00.000Z")],
    ["rm take out thrash on Monday at 7pm", toUtc("2022-08-08T19:00:00.000Z")],
    ["take the thrash on Tuesday morning ", toUtc("2022-08-09T09:00:00.000Z")],
    ["Take the thrash on october 17th", toUtc("2022-10-17T09:00:00.000Z")],
    ["Take the thrash in october 1st", toUtc("2022-10-01T09:00:00.000Z")],
    ["Take the thrash in June 17th", toUtc("2023-06-17T09:00:00.000Z")],
    // ["Take the thrash next weekend", toUtc("2022-08-08T08:00:00.000Z")],
    // ["Take the thrash in the weekend", toUtc("2022-08-08T08:00:00.000Z")],
    // ["Take the thrash next weekday", toUtc("2022-08-08T08:00:00.000Z")],
    ["Take the thrash next week", toUtc("2022-08-15T07:00:00.000Z")],
    ["whatever next monday", toUtc("2022-08-15T09:00:00.000Z")],
  ] as [string, Date][]

  describe.each(scenarios)("Should parse date in scenario: %s", (str, expected) => {
    it(`should return ${expected.toISOString()}`, () => {
      expect(extractDate(str, { currentDate, tz }).date).toEqual(expected)
    })
  })

  it("should return a valid IParseResult for relative dates", () => {
    const scenario = "take the thrash this tuesday"

    expect(extractDate(scenario, { currentDate, tz })).toEqual({
      rawResult: expect.any(ParsingResult),
      date: expect.any(Date),
      from: 16,
      to: 28,
      trigger: "this tuesday",
    })
  })

  it("should return a valid IParseResult for absolute dates", () => {
    const scenario = "take out the thrash at 3:15pm"

    expect(extractDate(scenario, { currentDate, tz })).toEqual({
      rawResult: expect.any(ParsingResult),
      date: expect.any(Date),
      from: 20,
      to: 29,
      trigger: "at 3:15pm",
    })
  })

  it("should return a valid IParseResult for weird double dates", () => {
    const scenario = "remind me something in one hour in two hours"

    expect(extractDate(scenario, { currentDate, tz })).toEqual({
      rawResult: expect.any(ParsingResult),
      date: expect.any(Date),
      from: 32,
      to: 44,
      trigger: "in two hours",
    })
  })
})
