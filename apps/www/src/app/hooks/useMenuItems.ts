import { usePathname } from "next/navigation"
import { navLinks } from "../../lib/static"

export const useMenuItems = () => {
  const pathname = usePathname()

  return navLinks.map((l) => ({
    active: l.url === pathname,
    url: l.url,
    name: l.name,
  }))
}
