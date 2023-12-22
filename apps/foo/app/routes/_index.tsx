import type { MetaFunction } from "@remix-run/node"
import { Link } from "@remix-run/react"
import { useState } from "react"

export const meta: MetaFunction = () => {
  return [{ title: "Foo" }, { name: "description", content: "Don't mind me, just testing" }]
}

export default function Index() {
  const [count, setCount] = useState(0)
  return (
    <main>
      <section>
        <h1>Foo</h1>
        <p>Count: {count}</p>
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <span>
            <button onClick={() => setCount((c) => c + 1)}>Increment</button>
          </span>
          <Link to="/foo">Go to Foo</Link>
        </div>
      </section>
    </main>
  )
}
