import * as DropdownMenu from "@radix-ui/react-dropdown-menu"
import { IconMenu } from "@tabler/icons-react"
import clsx from "clsx"
import { useMenuItems } from "../../hooks"
import { MenuLink } from "./MenuLink"

type HamburgerMenuProps = {
  toggleTheme: () => void
  toggleThemeButtonLabel: React.ReactNode
}

export const HamburgerMenu: React.FC<HamburgerMenuProps> = ({
  toggleThemeButtonLabel: toggleThemeLabel,
  toggleTheme,
}) => {
  const menuItems = useMenuItems().map((e) => (
    <DropdownMenu.Item key={e.url}>
      <MenuLink active={e.active} url={e.url} content={e.name} />
    </DropdownMenu.Item>
  ))

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          className={clsx(
            "flex h-10 w-10 items-center justify-center space-y-8 rounded-lg bg-slate-50 outline-none md:hidden",
            "hover:bg-slate-200 dark:hover:bg-slate-700",
            "dark:bg-gray-800",
            "data-[state=open]:bg-slate-100"
          )}
        >
          <IconMenu className="h-10" />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content className="flex w-[100vw] flex-col items-center gap-8 rounded-lg bg-white p-8 font-semibold shadow-md outline-none dark:bg-neuda-800/95 dark:shadow-neuda-700 md:hidden">
          {menuItems}
          <DropdownMenu.Item>
            <button
              className="w-[100vw]] flex items-center justify-center gap-2 rounded-full bg-slate-100 p-4 font-bold hover:bg-slate-200 dark:bg-slate-900 dark:hover:bg-slate-800"
              onClick={() => toggleTheme()}
            >
              {toggleThemeLabel}
            </button>
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  )
}
