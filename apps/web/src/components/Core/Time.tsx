import dayjs from "dayjs"

type TimeProps = {
  className?: string
  format?: string
  date: string
}

export const Time: React.FC<TimeProps> = ({ className, format, date }) => {
  return (
    <time dateTime={date} className={className}>
      {dayjs(date).format(format)}
    </time>
  )
}
