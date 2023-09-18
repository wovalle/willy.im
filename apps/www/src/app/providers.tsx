"use client"

import { LuchyNextAppProvider } from "@luchyio/next"
import { ThemeProvider } from "next-themes"
import { FC, ReactNode } from "react"

type ProvidersProps = {
  children: ReactNode
}

const Providers: FC<ProvidersProps> = ({ children }) => {
  return (
    <ThemeProvider attribute="class" defaultTheme="system">
      <LuchyNextAppProvider>{children}</LuchyNextAppProvider>
    </ThemeProvider>
  )
}

export { Providers }
