interface SelectProps {
  options: {
    value: string
    label: string
  }[]
  id?: string
  selected: string
  onChange: (value: string) => void
}

export const InlineSelect: React.FC<SelectProps> = ({ options, id, onChange, selected }) => {
  return (
    <select
      id={id}
      className="cursor-pointer appearance-none border-b-2 border-dotted border-neuda bg-transparent text-center font-bold hover:border-solid hover:border-prim-200"
      onChange={(e) => onChange(e.target.value)}
      value={selected}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  )
}
