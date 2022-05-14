import { BlockWithChildren, RichText } from "@jitl/notion-api/src/lib/notion-api"
import clsx from "clsx"

type TextProps = {
  text: RichText
}

type RichTextText = Extract<RichText[number], { type: "text" }>
const filterRichTextText = (rt: RichText[number]): rt is RichTextText => rt.type === "text"

export const Text = ({ text }: TextProps) => {
  const components = text.filter(filterRichTextText).map((value, index) => {
    const { color, ...rest } = value.annotations

    const hasAnnotations = Object.values(rest).some(Boolean)

    return hasAnnotations ? (
      <span key={index} className={clsx(value.annotations)}>
        {value.text.link ? (
          <a href={value.text.link.url}>{value.text.content}</a>
        ) : (
          value.text.content
        )}
      </span>
    ) : (
      <>{value.text.content}</>
    )
  })

  return <>{components}</>
}

export const notionBlockToDOM = (block: BlockWithChildren) => {
  switch (block.type) {
    case "paragraph": {
      return (
        <p>
          <Text text={block.paragraph.rich_text} />
        </p>
      )
    }
    case "heading_1":
      return (
        <h1>
          <Text text={block.heading_1.rich_text} />
        </h1>
      )
    case "heading_2":
      return (
        <h2>
          <Text text={block.heading_2.rich_text} />
        </h2>
      )
    case "heading_3":
      return (
        <h3>
          <Text text={block.heading_3.rich_text} />
        </h3>
      )
    case "bulleted_list_item":
      return (
        <li>
          <Text text={block["bulleted_list_item"].rich_text} />
        </li>
      )

    case "numbered_list_item":
      return (
        <li>
          <Text text={block["numbered_list_item"].rich_text} />
        </li>
      )

    case "quote":
      return (
        <blockquote>
          <Text text={block["quote"].rich_text} />
        </blockquote>
      )

    case "toggle":
      return (
        <details>
          <summary>
            <Text text={block["toggle"].rich_text} />
          </summary>
          {block.children.map((c) => notionBlockToDOM(c))}
        </details>
      )

    case "callout":
      return (
        <div className="callout">
          <Text text={block["callout"].rich_text} />
        </div>
      )

    default:
      return `❌ Unsupported block: ${block.type}; ${JSON.stringify(block, null, 2)}`
  }
}