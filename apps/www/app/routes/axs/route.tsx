import type { ReactNode } from "react"
import { useCallback, useEffect, useRef, useState } from "react"
import type { Route } from "./+types/route"
import stylesHref from "./34.css?url"

const faqItems: Array<{ question: string; answer: ReactNode }> = [
  {
    question: "cuándo e' la vaina?",
    answer:
      "papi pero lee el flyer, dice 27 de febrero clarito. Y nos vamos el 27 temprano que vamos ese día pa Miches a hacer cuatrimotos ",
  },
  {
    question: "cuánto e' que hay que pagar?",
    answer: "Son U$35 por persona. Cada quién puede llevar su +1 así que 70 por pareja",
  },
  {
    question: "qué llevo?",
    answer: "traéte par de potes, vuélvete loco",
  },
  {
    question: "ROMO GRATIS",
    answer: "mentira del diablo, ahora que tengo tu atención CONFIRMA ANTES DEL 20 DE ENERO",
  },
]

const onomatopoeia = ["CLICK!", "POP!", "WHOOSH!", "BAM!", "POW!"]

interface OnomatopoeiaInstance {
  id: number
  text: string
  x: number
  y: number
}

export const meta: Route.MetaFunction = () => {
  return [
    { title: "Julio Alexis Birthday Bash" },
    {
      name: "description",
      content:
        "Invitación para la celebración del cumpleaños de Julio Alexis. Del 27 de Febrero al 1ro de Marzo en Higüey.",
    },
  ]
}

export const links: Route.LinksFunction = () => {
  return [
    { rel: "stylesheet", href: stylesHref },
    {
      rel: "preconnect",
      href: "https://fonts.googleapis.com",
    },
    {
      rel: "preconnect",
      href: "https://fonts.gstatic.com",
      crossOrigin: "anonymous",
    },
    {
      rel: "stylesheet",
      href: "https://fonts.googleapis.com/css2?family=Bangers&family=Montserrat:wght@400;700;900&display=swap",
    },
  ]
}

export default function AxsPage(_: Route.ComponentProps) {
  const [openIndex, setOpenIndex] = useState<number>(-1)
  const [onomatopoeiaInstances, setOnomatopoeiaInstances] = useState<OnomatopoeiaInstance[]>([])
  const nextIdRef = useRef<number>(0)

  // Generate random position within visible area (with padding from edges)
  const getRandomPosition = () => {
    // Padding from edges: 15% on all sides
    const padding = 15
    const x = padding + Math.random() * (100 - padding * 2)
    const y = padding + Math.random() * (100 - padding * 2)
    return { x, y }
  }

  // Create a new random onomatopoeia instance
  const createRandomOnomatopoeia = useCallback(() => {
    const randomText = onomatopoeia[Math.floor(Math.random() * onomatopoeia.length)]
    const position = getRandomPosition()
    const id = nextIdRef.current
    nextIdRef.current += 1

    setOnomatopoeiaInstances((prev) => [
      ...prev,
      { id, text: randomText, x: position.x, y: position.y },
    ])

    // Remove after animation completes
    setTimeout(() => {
      setOnomatopoeiaInstances((prev) => prev.filter((instance) => instance.id !== id))
    }, 600)
  }, [])

  // Auto-trigger random onomatopoeia at random intervals
  useEffect(() => {
    const scheduleNext = () => {
      const delay = 500 + Math.random() * 3000 // 0.5s to 3.5s
      const timeoutId = setTimeout(() => {
        createRandomOnomatopoeia()
        scheduleNext()
      }, delay)
      return timeoutId
    }

    const timeoutId = scheduleNext()
    return () => clearTimeout(timeoutId)
  }, [createRandomOnomatopoeia])

  const handleToggle = (index: number) => {
    setOpenIndex((prev) => (prev === index ? -1 : index))

    // Also show onomatopoeia effect on click
    createRandomOnomatopoeia()
  }

  return (
    <main className="invitation-axs">
      <div className="invitation-axs__falling-beers" aria-hidden="true">
        <span />
        <span />
        <span />
        <span />
        <span />
        <span />
        <span />
        <span />
        <span />
        <span />
        <span />
        <span />
      </div>

      <div className="invitation-axs__hero">
        <div className="invitation-axs__title-wrapper">
          <h1 className="invitation-axs__title">VENGAN PA' MI CUMPLEAÑOS</h1>
        </div>
        <div className="invitation-axs__image-wrapper">
          <img src="/axs/comic-2.jpg" alt="Julio Alexis Birthday Invitation" />
        </div>
      </div>

      {onomatopoeiaInstances.map((instance) => (
        <div
          key={instance.id}
          className="invitation-axs__onomatopoeia"
          style={{
            left: `${instance.x}%`,
            top: `${instance.y}%`,
          }}
        >
          {instance.text}
        </div>
      ))}

      <section className="invitation-axs__faq">
        <h2 className="invitation-axs__faq-title">FAQ</h2>
        <ul className="invitation-axs__faq-list">
          {faqItems.map((item, index) => {
            const isOpen = openIndex === index

            return (
              <li key={item.question} className="invitation-axs__faq-item" data-open={isOpen}>
                <button
                  className="invitation-axs__faq-question"
                  type="button"
                  onClick={() => handleToggle(index)}
                  aria-expanded={isOpen}
                  aria-controls={`faq-panel-${index}`}
                >
                  <span className="invitation-axs__speech-bubble-icon">💬</span>
                  {item.question}
                  <span aria-hidden="true" className="invitation-axs__faq-icon" data-open={isOpen}>
                    <svg viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
                      <path
                        d="M5 7.5L10 12.5L15 7.5"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </span>
                </button>
                {isOpen && (
                  <p id={`faq-panel-${index}`} className="invitation-axs__faq-answer">
                    {item.answer}
                  </p>
                )}
              </li>
            )
          })}
        </ul>
      </section>
    </main>
  )
}
