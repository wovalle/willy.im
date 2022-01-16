type ShortyFormProps = {
  baseUrl?: string
}

const ShortyForm: React.FC<ShortyFormProps> = ({ baseUrl = "s" }) => {
  const saveUrl = `${baseUrl}/save`
  return (
    <>
      <h1>Shorty</h1>
      <form action={saveUrl}>
        <input type="text" id="fname" name="fname" value="John" />

        <input type="submit" value="Submit" />
      </form>
    </>
  )
}

export { ShortyForm }
