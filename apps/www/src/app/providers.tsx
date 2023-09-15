"use client"

import { ThemeProvider } from "next-themes"
import { FC, ReactNode } from "react"

type ProvidersProps = {
  children: ReactNode
}

const Providers: FC<ProvidersProps> = ({ children }) => {
  return (
    <ThemeProvider attribute="class" defaultTheme="system">
      {/* TODO: defaults */}
      {/* <LuchyNextProvider baseUrl={"/api/luchy"}> */}
      {children}
      {/* </LuchyNextProvider> */}
    </ThemeProvider>
  )
}

export { Providers }
