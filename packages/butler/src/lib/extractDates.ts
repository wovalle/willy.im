import * as chrono from "chrono-node"
import { Days, Months, RelativeDateLabels, StartOfDayHour } from "../constants"
import { ICustomExtractor as ICustomDataExtractor } from "../types"
import { required } from "./common"

const customChrono = chrono.casual.clone()

customChrono.refiners.push({
  refine: (context, results) => {
    const onMonthsRegex = new RegExp(`(in|on) (${Months.join("|")})`, "i")
    const onDaysRegex = new RegExp(`(in|on) (${Days.join("|")})`, "i")
    const relativeDateRegex = new RegExp(`${RelativeDateLabels.join("|")}`, "i")

    // If you mentioned "[in|on] <weekday>" and is the same day as today and the hour is in the past, set it to next week
    if (onDaysRegex.test(context.text)) {
      results.forEach((result) => {
        if (
          result.refDate.getDay() === result.start.date().getDay() &&
          result.refDate > result.start.date()
        ) {
          result.start.assign("day", (result.start.get("day") ?? 0) + 7)
        }
      })
    }

    // If you mentioned "[in|on] <month>" and is in the past, set it to next year
    if (context.text.match(onMonthsRegex)) {
      results.forEach((result) => {
        if (result.refDate.getMonth() > (result.start.get("month") ?? 0)) {
          result.start.assign("year", (result.start.get("year") ?? 0) + 1)
        }
      })
    }

    // If we have a relative date AND no time was specified, set the time to the start of the day
    if (
      relativeDateRegex.test(context.text) ||
      onDaysRegex.test(context.text) ||
      onMonthsRegex.test(context.text)
    ) {
      results.forEach((result) => {
        if (!result.start.getCertainComponents().includes("hour")) {
          result.start.assign("hour", StartOfDayHour)
        }
      })
    }

    return results
  },
})

type IDateExtractor = ICustomDataExtractor<{
  date: Date
  rawResult: chrono.ParsedResult
}>

export const extractDate = (
  str: string,
  options: { currentDate: Date; tz: string }
): IDateExtractor => {
  const parsedChronoResult = customChrono.parse(str, {
    instant: options.currentDate,
    timezone: options.tz,
  })

  // TODO: parse date intervals, right now I'm just taking the last one
  const result = parsedChronoResult.at(-1)

  if (!result) {
    return {
      trigger: null,
      from: 0,
      to: 0,
      date: null,
      rawResult: null,
    }
  }

  return {
    trigger: required(result?.text, "Text in result is undefined"),
    from: result?.index ?? 0,
    to: (result?.text.length ?? 0) + (result?.index ?? 0),
    date: required(result?.start.date(), "Date in result is undefined"),
    rawResult: result,
  }
}
