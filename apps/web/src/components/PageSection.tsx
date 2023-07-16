import clsx from "clsx"
import { ReactNode } from "react"

export type AboutSectionProps = {
  title?: string
  subtitle?: ReactNode
  id: string
  className?: string
  bodyClassName?: string
  bleed?: boolean
  children: ReactNode
  icon?: ReactNode
}

export const PageSection: React.FC<AboutSectionProps> = ({
  children,
  title,
  subtitle,
  id,
  className,
  bodyClassName,
  bleed,
  icon,
}) => (
  <section
    className={clsx("relative rounded-xl", className, { "-mx-10 md:-mx-20": bleed })}
    id={id}
  >
    <div className={clsx("grid gap-4", { "p-10 md:px-20": bleed })}>
      <div className="section.header">
        <h2 className="text-title text-xl font-semibold tracking-tight md:text-3xl">{title}</h2>
        <h3 className="text-subtitle text-sm">{subtitle}</h3>

        {icon ? <div className="absolute right-10 top-10 md:right-20">{icon}</div> : null}
      </div>
      <div className={clsx("section-body", bodyClassName)}>{children}</div>
    </div>
  </section>
)
