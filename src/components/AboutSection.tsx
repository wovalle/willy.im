import { ReactNode } from "react"

export type AboutSectionProps = {
  title: string
  subtitle?: ReactNode
  id?: string
}

export const AboutSection: React.FC<AboutSectionProps> = ({ children, title, subtitle, id }) => (
  <section className="mt-4" id={id ?? title.replace(" ", "-")}>
    <div className="section-header">
      <p className="text-3xl font-bold text-title ">
        <span>{title}</span>
      </p>
      <p className="text-sm font-bold text-subtitle">{subtitle}</p>
    </div>

    <div className="pt-2 pb-4">{children}</div>
  </section>
)
