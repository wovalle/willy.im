import { useRouter } from "next/router"
import { footerLinks } from "../lib/static"

export const useMenuItems = () => {
  const router = useRouter()

  return footerLinks.map((l) => ({
    active: router.pathname === l.url,
    url: l.url,
    name: l.name,
  }))
}
