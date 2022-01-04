import { ReactNode } from "react"

export type AboutSectionProps = {
  title: string
  subtitle?: ReactNode
  id: string
  icon?: ReactNode
}

export const AboutSection: React.FC<AboutSectionProps> = ({
  children,
  title,
  subtitle,
  id,
  icon,
}) => (
  <section className="mt-4" id={id}>
    <h1 className="text-3xl font-bold text-title">
      <span className="flex">
        {icon ? icon : null}
        {title}
      </span>
    </h1>
    <h2 className="text-sm font-bold text-subtitle">{subtitle}</h2>

    <div className="pt-2 pb-4">{children}</div>
  </section>
)
