import {
  Accordion,
  AccordionItem,
  ActionIcon,
  Stack,
  TextInput,
  rem,
  useMantineTheme,
} from "@mantine/core"
import { IconArrowRight, IconSearch } from "@tabler/icons-react"
import { useState } from "react"
import { queryBasePrompt } from "../static"
import { runPrompt } from "../utils/openai"

type AccordionItem = {
  emoji: string
  value: string
  description: string
}

export const AiPage = () => {
  const theme = useMantineTheme()
  const [prompt, setPrompt] = useState("What songs did I listen in november 2021?")
  const [accordion, setAccordion] = useState<AccordionItem[]>([])
  const [loading, setLoading] = useState(false)

  const handleClick = async () => {
    setLoading(true)
    const fullPrompt = queryBasePrompt + prompt
    const completionResponse = await runPrompt(fullPrompt)
    const queryCommandResponse = JSON.parse(completionResponse.choices[0]?.message.content ?? "")

    setAccordion([
      {
        emoji: "👋",
        value: "Prompt",
        description: prompt,
      },
      {
        emoji: "🥦",
        value: "FullPrompt",
        description: fullPrompt,
      },
      {
        emoji: "📊",
        value: "Response",
        description: JSON.stringify(completionResponse, null, 2),
      },
      {
        emoji: "📜",
        value: "SqlQuery",
        description: JSON.stringify(queryCommandResponse.sqlQuery, null, 2),
      },
    ])

    console.log("klk", queryCommandResponse.sqlQuery)
    setLoading(false)
  }

  const items = accordion.map((item) => (
    <Accordion.Item key={item.value} value={item.value}>
      <Accordion.Control icon={item.emoji}>{item.value}</Accordion.Control>
      <Accordion.Panel>{item.description}</Accordion.Panel>
    </Accordion.Item>
  ))

  return (
    <main>
      <Stack>
        <TextInput
          radius="xl"
          size="md"
          placeholder="Ask ai"
          value={prompt}
          onChange={(event) => setPrompt(event.currentTarget.value)}
          rightSectionWidth={42}
          leftSection={<IconSearch style={{ width: rem(18), height: rem(18) }} stroke={1.5} />}
          rightSection={
            <ActionIcon
              size={32}
              radius="xl"
              color={theme.primaryColor}
              variant="filled"
              onClick={() => handleClick()}
            >
              <IconArrowRight style={{ width: rem(18), height: rem(18) }} stroke={1.5} />
            </ActionIcon>
          }
        />
        {loading && <div>Loading...</div>}

        <Accordion>{items}</Accordion>
      </Stack>
    </main>
  )
}
