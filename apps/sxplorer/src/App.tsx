import "@mantine/core/styles.css"
import "mantine-datatable/styles.layer.css"

import { MantineProvider } from "@mantine/core"
import { Layout } from "./components/Layout"

import { DBProvider } from "@vlcn.io/react"
import { useState } from "react"
import { PageContext, routes } from "./static"

import schemaContent from "./db/schema.sql?raw"

const schema = {
  name: "main.sql",
  content: schemaContent,
}

function App() {
  const [route, setRoute] = useState("index")

  const pageContext: PageContext = {
    currentRoute: route,
    setRoute,
  }

  // @ts-expect-error expected
  const CurrentRoute = routes[route].component

  return (
    <MantineProvider>
      <DBProvider
        dbname="sxplorer"
        schema={schema}
        Render={() => (
          <Layout context={pageContext}>
            <CurrentRoute />
          </Layout>
        )}
      ></DBProvider>
    </MantineProvider>
  )
}

export default App
