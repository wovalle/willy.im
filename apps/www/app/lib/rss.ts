export interface RSSItem {
  title: string
  link: string
  description?: string
  pubDate?: string
  content?: string
  guid?: string
}

export interface RSSFeed {
  title: string
  description?: string
  link?: string
  items: RSSItem[]
}

export class RSSParser {
  constructor() {}

  parseXML(xmlText: string): RSSFeed {
    // Simple regex-based XML parser for Cloudflare Workers
    const extractSingleTagContent = (xml: string, tagName: string): string => {
      const regex = new RegExp(`<${tagName}[^>]*>(.*?)</${tagName}>`, "s")
      const match = regex.exec(xml)
      if (!match) return ""

      let content = match[1].trim()

      // Handle CDATA sections
      if (content.includes("<![CDATA[")) {
        content = extractCDATAContent(content)
      }

      return content
    }

    const extractCDATAContent = (content: string): string => {
      const cdataRegex = /<!\[CDATA\[(.*?)\]\]>/gs
      const match = cdataRegex.exec(content)
      return match ? match[1].trim() : content
    }

    // Extract channel info
    const channelTitle = extractSingleTagContent(xmlText, "title")
    const channelDescription = extractSingleTagContent(xmlText, "description")
    const channelLink = extractSingleTagContent(xmlText, "link")

    // Extract items
    const itemMatches = xmlText.match(/<item[^>]*>.*?<\/item>/gs) || []
    const items = itemMatches.map((itemXml) => {
      const title = extractSingleTagContent(itemXml, "title")
      const link = extractSingleTagContent(itemXml, "link")
      const description = extractSingleTagContent(itemXml, "description")
      const pubDate = extractSingleTagContent(itemXml, "pubDate")
      const guid = extractSingleTagContent(itemXml, "guid")

      // Extract CDATA content from description
      const content = extractCDATAContent(description)

      return {
        title,
        link,
        description,
        pubDate,
        content,
        guid,
      }
    })

    // Check if we got valid data
    if (!channelTitle && items.length === 0) {
      throw new Error("Invalid RSS feed: no title or items found")
    }

    return {
      title: channelTitle,
      description: channelDescription,
      link: channelLink,
      items,
    }
  }
}

// Fetch and parse RSS feed from URL
export const parseURL = async (url: string, fetchFn: typeof fetch = fetch): Promise<RSSFeed> => {
  try {
    const response = await fetchFn(url)
    if (!response.ok) {
      throw new Error(`Failed to fetch RSS feed: ${response.status} ${response.statusText}`)
    }
    const xmlText = await response.text()
    return parseXML(xmlText)
  } catch (error) {
    throw new Error(
      `Failed to parse RSS feed: ${error instanceof Error ? error.message : "Unknown error"}`,
    )
  }
}

// Function to parse XML string directly (for testing)
export const parseXML = (xmlText: string): RSSFeed => {
  const parser = new RSSParser()
  return parser.parseXML(xmlText)
}
