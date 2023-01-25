import dayjs from "dayjs"
import utc from "dayjs/plugin/utc"

dayjs.extend(utc)

export const toUtc = (strOrDate: string | Date) => {
  return dayjs(strOrDate).utc().toDate()
}
