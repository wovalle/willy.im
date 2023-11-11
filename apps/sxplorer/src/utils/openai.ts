import { OpenAIClient } from "openai-fetch"

const openai = new OpenAIClient({
  apiKey: "",
})

export const runPrompt = async (text: string) => {
  const chatCompletion = await openai.createChatCompletion({
    messages: [{ role: "user", content: text }],
    model: "gpt-3.5-turbo",
  })

  return chatCompletion
}
