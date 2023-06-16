import { Listbox } from "@headlessui/react"
import { IconCaretDown, IconCaretUp } from "@tabler/icons-react"
import clsx from "clsx"

interface SelectProps {
  options: {
    value: string
    label: string
  }[]
  id?: string
  selected: string
  onChange: (value: string) => void
}

export const InlineSelect: React.FC<SelectProps> = ({ options, onChange, selected }) => {
  return (
    <span className="relative">
      <Listbox value={selected} onChange={onChange}>
        {({ open }) => {
          const Caret = open ? IconCaretUp : IconCaretDown

          return (
            <>
              <Listbox.Button className="cursor-pointer border-b-2 border-dotted border-neuda font-bold">
                <span className="flex items-center pl-1">
                  {selected} <Caret size="1em" />
                </span>
              </Listbox.Button>
              <Listbox.Options className="text-md absolute -left-3 z-10 mt-2 flex flex-col gap-2 rounded-md bg-white font-medium text-gray-700 shadow-lg dark:bg-gray-800 dark:text-gray-200">
                {options.map((o) => (
                  <Listbox.Option
                    key={o.value}
                    value={o.value}
                    className={clsx(
                      { "font-bold": o.value === selected },
                      "cursor-pointer px-4 py-2 hover:bg-slate-200 dark:hover:bg-slate-600 md:px-3 md:py-1"
                    )}
                  >
                    {o.label}
                  </Listbox.Option>
                ))}
              </Listbox.Options>
            </>
          )
        }}
      </Listbox>
    </span>
  )
}
