export type MarkdownContentProps = {
  content: string
}

export const MarkdownContent: React.FC<MarkdownContentProps> = ({ content }) => (
  <div className="markddown" dangerouslySetInnerHTML={{ __html: content }} />
)
