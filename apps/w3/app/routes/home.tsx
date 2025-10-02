import type { Route } from "./+types/home"

export function meta({}: Route.MetaArgs) {
  return [{ title: "klk" }, { name: "description", content: "Welcome to klk!" }]
}

export default function Home() {
  return (
    <main className="flex flex-grow flex-col gap-24 py-16 px-6">
      <section id="hero" className="grid md:grid-cols-5">
        <div className="text-subtitle col-span-4 mr-4 flex flex-col gap-4">
          <p>klk</p>
        </div>
      </section>
    </main>
  )
}
