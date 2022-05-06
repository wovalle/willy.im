import clsx from "clsx"
import { ReactNode } from "react"

export type AboutSectionProps = {
  title?: string
  subtitle?: ReactNode
  id: string
  className?: string
  bodyClassName?: string
  bleed?: boolean
}

export const PageSection: React.FC<AboutSectionProps> = ({
  children,
  title,
  subtitle,
  id,
  className,
  bodyClassName,
  bleed,
}) => (
  <section className={clsx("relative", className, bleed && "-mx-10 md:-mx-20")} id={id}>
    <div className={clsx("grid gap-4 ", bleed && "p-10 md:px-20")}>
      <div className="section.header">
        <h1 className="text-title text-xl font-bold tracking-tight md:text-3xl">{title}</h1>
        <h2 className="text-subtitle text-sm font-bold">{subtitle}</h2>
      </div>
      <div className={clsx("section-body", bodyClassName)}>{children}</div>
    </div>
  </section>
)
