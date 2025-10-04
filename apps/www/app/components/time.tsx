import dayjs from "dayjs"

type TimeProps = {
  className?: string
  format?: string
  date: string
}

export const Time = ({ className, format, date }: TimeProps) => {
  return (
    <time dateTime={date} className={className}>
      {dayjs(date).format(format ?? "DD-MM-YYYY")}
    </time>
  )
}
