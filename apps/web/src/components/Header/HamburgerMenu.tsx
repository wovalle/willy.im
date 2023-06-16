import { Menu } from "@headlessui/react"
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
    <Menu.Item as="li" key={e.url}>
      <MenuLink active={e.active} url={e.url} content={e.name} />
    </Menu.Item>
  ))

  return (
    <Menu as="menu" className="md:hidden">
      {({ open }) => (
        <>
          <Menu.Button
            className={clsx(
              open && "bg-slate-100",
              "flex h-10 w-10 items-center justify-center space-y-8 rounded-lg bg-slate-50 outline-none md:hidden",
              "hover:bg-slate-200 dark:hover:bg-slate-700",
              "dark:bg-gray-800"
            )}
          >
            <IconMenu className="h-10" />
          </Menu.Button>
          <Menu.Items
            className="focus:outline-none-black absolute right-0 z-10 mt-12 flex w-full flex-col items-center gap-8 rounded-lg bg-white p-8 font-semibold shadow-md outline-none dark:bg-neuda-800/95 dark:shadow-neuda-700 md:hidden"
            as="ul"
          >
            {menuItems}
            <Menu.Item as="li">
              <button
                className="flex w-full items-center justify-center gap-2 rounded-full bg-slate-100 p-4 font-bold hover:bg-slate-200 dark:bg-slate-900 dark:hover:bg-slate-800"
                onClick={() => toggleTheme()}
              >
                {toggleThemeLabel}
              </button>
            </Menu.Item>
          </Menu.Items>
        </>
      )}
    </Menu>
  )
}
