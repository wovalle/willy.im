import * as Select from "@radix-ui/react-select"
import { IconChevronDown, IconChevronUp } from "@tabler/icons-react"

interface SelectProps<T> {
  options: {
    value: T
    label: string
  }[]
  id?: string
  selected: T
  onChange: (value: T) => void
}

export const InlineSelect = <T extends string>({ options, onChange, selected }: SelectProps<T>) => {
  const selectOptions = options.map((o) => (
    <Select.Item
      className="cursor-pointer px-4 py-2 hover:bg-slate-200 data-[state=checked]:font-bold dark:hover:bg-slate-600 md:px-3 md:py-1"
      key={o.value}
      value={o.value}
    >
      <Select.ItemText>{o.label}</Select.ItemText>
    </Select.Item>
  ))

  return (
    <span className="relative">
      <Select.Root value={selected} onValueChange={onChange}>
        <Select.Trigger className="inline-flex cursor-pointer select-none items-center border-b-2 border-dotted border-neuda font-bold">
          <Select.Value />
          <Select.Icon>
            <IconChevronDown size="1rem" />
          </Select.Icon>
        </Select.Trigger>
        <Select.Portal>
          <Select.Content className="text-md flex select-none flex-col gap-2 rounded-md bg-white text-sm text-gray-700 shadow-lg dark:bg-gray-800 dark:text-gray-200">
            <Select.ScrollUpButton>
              <IconChevronUp size="1rem" />
            </Select.ScrollUpButton>
            <Select.Viewport>{selectOptions}</Select.Viewport>
            <Select.ScrollDownButton>
              <IconChevronDown size="1rem" />
            </Select.ScrollDownButton>
          </Select.Content>
        </Select.Portal>
      </Select.Root>
    </span>
  )
}
