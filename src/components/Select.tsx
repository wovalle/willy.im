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
      className="border border-gray-300 shadow-sm"
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
