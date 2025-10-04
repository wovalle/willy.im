import {
  Content,
  Icon,
  Item,
  ItemText,
  Portal,
  Root,
  ScrollDownButton,
  ScrollUpButton,
  Trigger,
  Viewport,
} from "@radix-ui/react-select"
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
    <Item
      className="cursor-pointer px-4 py-2 hover:bg-slate-200 data-[state=checked]:font-bold dark:hover:bg-slate-600 md:px-3 md:py-1"
      key={o.value}
      value={o.value}
    >
      <ItemText>{o.label}</ItemText>
    </Item>
  ))

  // Find the label for the selected value
  const selectedLabel = options.find((o) => o.value === selected)?.label || selected

  return (
    <span className="relative">
      <Root value={selected} onValueChange={onChange}>
        <Trigger className="border-neuda inline-flex cursor-pointer select-none items-center border-b-2 border-dotted font-bold">
          <span>{selectedLabel}</span>
          <Icon>
            <IconChevronDown size="1rem" />
          </Icon>
        </Trigger>
        <Portal>
          <Content className="text-md flex select-none flex-col gap-2 rounded-md bg-white text-sm text-gray-700 shadow-lg dark:bg-gray-800 dark:text-gray-200">
            <ScrollUpButton>
              <IconChevronUp size="1rem" />
            </ScrollUpButton>
            <Viewport>{selectOptions}</Viewport>
            <ScrollDownButton>
              <IconChevronDown size="1rem" />
            </ScrollDownButton>
          </Content>
        </Portal>
      </Root>
    </span>
  )
}
