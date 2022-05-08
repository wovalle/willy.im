export type MarkdownContentProps = {
  content: string
  className?: string
}

export const MarkdownContent: React.FC<MarkdownContentProps> = ({ content, className }) => (
  <div className={className} dangerouslySetInnerHTML={{ __html: content }} />
)
