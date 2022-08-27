import { ReactNode, useEffect, useState } from "react"

export type ChildrenFC<Props = {}> = React.FC<Props & { children: ReactNode }>

export const useHasMounted = () => {
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  return mounted
}

export const ClientOnly: ChildrenFC = ({ children }) => {
  const mounted = useHasMounted()

  if (!mounted) {
    return null
  }

  return <>{children}</>
}
