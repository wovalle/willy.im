import type { ReactNode } from "react"
import { useState } from "react"
import type { Route } from "./+types/route"
import stylesHref from "./33.css?url"

const faqItems: Array<{ question: string; answer: ReactNode }> = [
  {
    question: "klk",
    answer: "klk manin",
  },
  {
    question: "tengo que confirmar que voy? qué llevo?",
    answer: "1- si 2- coño pero lee el flyer",
  },
  {
    question: "hay salvavidas?",
    answer: "voy a llevarte uno pampel mejor, flotan igualito",
  },
  {
    question: "hora dominicana?",
    answer: "el viernes a las 8pm en dominicano",
  },
  {
    question: "manda el location",
    answer: (
      <>
        <a
          href="https://maps.app.goo.gl/M6ZiPezaSiiJgmEs8"
          target="_blank"
          rel="noopener noreferrer"
        >
          manga el link
        </a>
        , cuando llegues pregúntale a los seguridad donde está el parqueo de los yates, ellos saben
      </>
    ),
  },
]

export const meta: Route.MetaFunction = () => {
  return [
    { title: "Willy cumple 33" },
    {
      name: "description",
      content:
        "Detalles y RSVP para la celebración del cumpleaños #33 de Willy en Marina de Boca Chica.",
    },
  ]
}

export const links: Route.LinksFunction = () => {
  return [{ rel: "stylesheet", href: stylesHref }]
}

export default function ThirtyThreePage(_: Route.ComponentProps) {
  const [openIndex, setOpenIndex] = useState<number>(-1)

  const handleToggle = (index: number) => {
    setOpenIndex((prev) => (prev === index ? -1 : index))
  }

  return (
    <main className="invitation-33">
      <div className="invitation-33__falling-heads" aria-hidden="true">
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
      <div className="invitation-33__image-wrapper">
        <img src="/33/33-3.png" alt="Willy cumple 33" />
      </div>
      <section className="invitation-33__faq">
        <h2 className="invitation-33__faq-title">Preguntas Frecuentes</h2>
        <ul className="invitation-33__faq-list">
          {faqItems.map((item, index) => {
            const isOpen = openIndex === index

            return (
              <li key={item.question} className="invitation-33__faq-item" data-open={isOpen}>
                <button
                  className="invitation-33__faq-question"
                  type="button"
                  onClick={() => handleToggle(index)}
                  aria-expanded={isOpen}
                  aria-controls={`faq-panel-${index}`}
                >
                  {item.question}
                  <span aria-hidden="true" className="invitation-33__faq-icon" data-open={isOpen}>
                    <svg viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
                      <path
                        d="M5 7.5L10 12.5L15 7.5"
                        stroke="currentColor"
                        strokeWidth="1.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </span>
                </button>
                {isOpen && (
                  <p id={`faq-panel-${index}`} className="invitation-33__faq-answer">
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
