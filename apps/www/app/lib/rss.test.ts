import { beforeEach, describe, expect, it, vi } from "vitest"
import { parseURL, parseXML, RSSParser } from "./rss"

describe("RSS Parser", () => {
  describe("parseXML", () => {
    it("should parse a valid RSS feed with all data types (happy path)", () => {
      const rssXML = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>Porcupine Tree Albums (1995-2005)</title>
    <description>Complete discography of Porcupine Tree albums from 1995 to 2005</description>
    <link>https://porcupinetree.com</link>
    <language>en-us</language>
    <lastBuildDate>Tue, 15 Jan 2024 12:00:00 GMT</lastBuildDate>
    
    <item>
      <title><![CDATA[The Sky Moves Sideways]]></title>
      <link>https://porcupinetree.com/album/the-sky-moves-sideways</link>
      <description><![CDATA[<p><strong>Release Date:</strong> January 30, 1995</p><p><strong>Genre:</strong> Progressive Rock</p><p><strong>Label:</strong> Delerium Records</p><p><strong>Length:</strong> 59:42</p><p><strong>rating:</strong> 4<br><strong>author:</strong> Steven Wilson<br>]]></description>
      <pubDate>Mon, 30 Jan 1995 00:00:00 GMT</pubDate>
      <guid isPermaLink="false">porcupinetree-the-sky-moves-sideways-1995</guid>
      <category>Progressive Rock</category>
      <enclosure url="https://porcupinetree.com/covers/the-sky-moves-sideways.jpg" type="image/jpeg" length="1024"/>
    </item>
    
    <item>
      <title><![CDATA[Signify]]></title>
      <link>https://porcupinetree.com/album/signify</link>
      <description><![CDATA[<p><strong>Release Date:</strong> September 30, 1996</p><p><strong>Genre:</strong> Progressive Rock, Alternative Rock</p><p><strong>Label:</strong> Delerium Records</p><p><strong>Length:</strong> 61:23</p><p><strong>rating:</strong> 5<br><strong>author:</strong> Steven Wilson<br>]]></description>
      <pubDate>Mon, 30 Sep 1996 00:00:00 GMT</pubDate>
      <guid isPermaLink="false">porcupinetree-signify-1996</guid>
      <category>Progressive Rock</category>
      <category>Alternative Rock</category>
    </item>
    
    <item>
      <title><![CDATA[Stupid Dream]]></title>
      <link>https://porcupinetree.com/album/stupid-dream</link>
      <description><![CDATA[<p><strong>Release Date:</strong> March 22, 1999</p><p><strong>Genre:</strong> Progressive Rock, Art Rock</p><p><strong>Label:</strong> Kscope</p><p><strong>Length:</strong> 51:47</p><p><strong>rating:</strong> 5<br><strong>author:</strong> Steven Wilson<br>]]></description>
      <pubDate>Mon, 22 Mar 1999 00:00:00 GMT</pubDate>
      <guid isPermaLink="false">porcupinetree-stupid-dream-1999</guid>
      <category>Progressive Rock</category>
      <category>Art Rock</category>
    </item>
    
    <item>
      <title><![CDATA[Lightbulb Sun]]></title>
      <link>https://porcupinetree.com/album/lightbulb-sun</link>
      <description><![CDATA[<p><strong>Release Date:</strong> May 22, 2000</p><p><strong>Genre:</strong> Progressive Rock, Art Rock</p><p><strong>Label:</strong> Kscope</p><p><strong>Length:</strong> 56:35</p><p><strong>rating:</strong> 4<br><strong>author:</strong> Steven Wilson<br>]]></description>
      <pubDate>Mon, 22 May 2000 00:00:00 GMT</pubDate>
      <guid isPermaLink="false">porcupinetree-lightbulb-sun-2000</guid>
      <category>Progressive Rock</category>
      <category>Art Rock</category>
    </item>
    
    <item>
      <title><![CDATA[Recordings]]></title>
      <link>https://porcupinetree.com/album/recordings</link>
      <description><![CDATA[<p><strong>Release Date:</strong> June 18, 2001</p><p><strong>Genre:</strong> Progressive Rock, Art Rock</p><p><strong>Label:</strong> Kscope</p><p><strong>Length:</strong> 54:17</p><p><strong>rating:</strong> 4<br><strong>author:</strong> Steven Wilson<br>]]></description>
      <pubDate>Mon, 18 Jun 2001 00:00:00 GMT</pubDate>
      <guid isPermaLink="false">porcupinetree-recordings-2001</guid>
      <category>Progressive Rock</category>
      <category>Art Rock</category>
    </item>
    
    <item>
      <title><![CDATA[In Absentia]]></title>
      <link>https://porcupinetree.com/album/in-absentia</link>
      <description><![CDATA[<p><strong>Release Date:</strong> September 24, 2002</p><p><strong>Genre:</strong> Progressive Rock, Alternative Metal</p><p><strong>Label:</strong> Lava Records</p><p><strong>Length:</strong> 63:25</p><p><strong>rating:</strong> 5<br><strong>author:</strong> Steven Wilson<br>]]></description>
      <pubDate>Tue, 24 Sep 2002 00:00:00 GMT</pubDate>
      <guid isPermaLink="false">porcupinetree-in-absentia-2002</guid>
      <category>Progressive Rock</category>
      <category>Alternative Metal</category>
    </item>
    
    <item>
      <title><![CDATA[Deadwing]]></title>
      <link>https://porcupinetree.com/album/deadwing</link>
      <description><![CDATA[<p><strong>Release Date:</strong> March 28, 2005</p><p><strong>Genre:</strong> Progressive Rock, Alternative Metal</p><p><strong>Label:</strong> Lava Records</p><p><strong>Length:</strong> 59:18</p><p><strong>rating:</strong> 5<br><strong>author:</strong> Steven Wilson<br>]]></description>
      <pubDate>Mon, 28 Mar 2005 00:00:00 GMT</pubDate>
      <guid isPermaLink="false">porcupinetree-deadwing-2005</guid>
      <category>Progressive Rock</category>
      <category>Alternative Metal</category>
    </item>
  </channel>
</rss>`

      const feed = parseXML(rssXML)

      // Channel metadata
      expect(feed.title).toBe("Porcupine Tree Albums (1995-2005)")
      expect(feed.description).toBe(
        "Complete discography of Porcupine Tree albums from 1995 to 2005",
      )
      expect(feed.link).toBe("https://porcupinetree.com")

      // Items count
      expect(feed.items).toHaveLength(7)

      // Test first item (The Sky Moves Sideways)
      const firstItem = feed.items[0]
      expect(firstItem.title).toBe("The Sky Moves Sideways")
      expect(firstItem.link).toBe("https://porcupinetree.com/album/the-sky-moves-sideways")
      expect(firstItem.guid).toBe("porcupinetree-the-sky-moves-sideways-1995")
      expect(firstItem.pubDate).toBe("Mon, 30 Jan 1995 00:00:00 GMT")
      expect(firstItem.description).toContain(
        "<p><strong>Release Date:</strong> January 30, 1995</p>",
      )
      expect(firstItem.content).toContain("<p><strong>Release Date:</strong> January 30, 1995</p>")

      // Test CDATA handling in title
      expect(firstItem.title).not.toContain("<![CDATA[")
      expect(firstItem.title).not.toContain("]]>")

      // Test middle item (Signify)
      const middleItem = feed.items[1]
      expect(middleItem.title).toBe("Signify")
      expect(middleItem.link).toBe("https://porcupinetree.com/album/signify")
      expect(middleItem.pubDate).toBe("Mon, 30 Sep 1996 00:00:00 GMT")

      // Test last item (Deadwing)
      const lastItem = feed.items[6]
      expect(lastItem.title).toBe("Deadwing")
      expect(lastItem.link).toBe("https://porcupinetree.com/album/deadwing")
      expect(lastItem.pubDate).toBe("Mon, 28 Mar 2005 00:00:00 GMT")

      // Verify all items have required fields
      feed.items.forEach((item, index) => {
        expect(item.title).toBeTruthy()
        expect(item.title).not.toContain("<![CDATA[")
        expect(item.link).toBeTruthy()
        expect(item.pubDate).toBeTruthy()
        expect(typeof item.title).toBe("string")
        expect(typeof item.link).toBe("string")
      })
    })

    it("should handle feeds with no items", () => {
      const rssXML = `<rss version="2.0">
  <channel>
    <title>Empty Feed</title>
    <description>No items</description>
  </channel>
</rss>`

      const feed = parseXML(rssXML)
      expect(feed.title).toBe("Empty Feed")
      expect(feed.items).toHaveLength(0)
    })

    it("should handle items with missing optional fields", () => {
      const rssXML = `<rss version="2.0">
  <channel>
    <title>Minimal Feed</title>
  </channel>
  <item>
    <title>Minimal Item</title>
    <link>https://example.com</link>
  </item>
</rss>`

      const feed = parseXML(rssXML)
      expect(feed.items).toHaveLength(1)
      expect(feed.items[0].title).toBe("Minimal Item")
      expect(feed.items[0].link).toBe("https://example.com")
      expect(feed.items[0].description).toBe("")
      expect(feed.items[0].pubDate).toBe("")
      expect(feed.items[0].content).toBe("")
      expect(feed.items[0].guid).toBe("")
    })

    it("should properly extract CDATA content from titles", () => {
      const rssXML = `<rss version="2.0">
  <channel>
    <title>CDATA Test</title>
  </channel>
  <item>
    <title><![CDATA[Clean Title Without CDATA]]></title>
    <link>https://example.com</link>
  </item>
</rss>`

      const feed = parseXML(rssXML)
      expect(feed.items[0].title).toBe("Clean Title Without CDATA")
      expect(feed.items[0].title).not.toContain("<![CDATA[")
      expect(feed.items[0].title).not.toContain("]]>")
    })

    it("should handle invalid XML gracefully", () => {
      const invalidXML = `<rss version="2.0">
  <channel>
    <title></title>
  </channel>
</rss>`

      expect(() => parseXML(invalidXML)).toThrow("Invalid RSS feed: no title or items found")
    })
  })

  describe("RSSParser class", () => {
    it("should work with class instantiation", () => {
      const rssXML = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>Porcupine Tree Albums (1995-2005)</title>
    <description>Complete discography of Porcupine Tree albums from 1995 to 2005</description>
    <link>https://porcupinetree.com</link>
    
    <item>
      <title><![CDATA[The Sky Moves Sideways]]></title>
      <link>https://porcupinetree.com/album/the-sky-moves-sideways</link>
      <description><![CDATA[<p><strong>Release Date:</strong> January 30, 1995</p>]]></description>
      <pubDate>Mon, 30 Jan 1995 00:00:00 GMT</pubDate>
      <guid isPermaLink="false">porcupinetree-the-sky-moves-sideways-1995</guid>
    </item>
    
    <item>
      <title><![CDATA[Signify]]></title>
      <link>https://porcupinetree.com/album/signify</link>
      <description><![CDATA[<p><strong>Release Date:</strong> September 30, 1996</p>]]></description>
      <pubDate>Mon, 30 Sep 1996 00:00:00 GMT</pubDate>
      <guid isPermaLink="false">porcupinetree-signify-1996</guid>
    </item>
    
    <item>
      <title><![CDATA[Stupid Dream]]></title>
      <link>https://porcupinetree.com/album/stupid-dream</link>
      <description><![CDATA[<p><strong>Release Date:</strong> March 22, 1999</p>]]></description>
      <pubDate>Mon, 22 Mar 1999 00:00:00 GMT</pubDate>
      <guid isPermaLink="false">porcupinetree-stupid-dream-1999</guid>
    </item>
    
    <item>
      <title><![CDATA[Lightbulb Sun]]></title>
      <link>https://porcupinetree.com/album/lightbulb-sun</link>
      <description><![CDATA[<p><strong>Release Date:</strong> May 22, 2000</p>]]></description>
      <pubDate>Mon, 22 May 2000 00:00:00 GMT</pubDate>
      <guid isPermaLink="false">porcupinetree-lightbulb-sun-2000</guid>
    </item>
    
    <item>
      <title><![CDATA[Recordings]]></title>
      <link>https://porcupinetree.com/album/recordings</link>
      <description><![CDATA[<p><strong>Release Date:</strong> June 18, 2001</p>]]></description>
      <pubDate>Mon, 18 Jun 2001 00:00:00 GMT</pubDate>
      <guid isPermaLink="false">porcupinetree-recordings-2001</guid>
    </item>
    
    <item>
      <title><![CDATA[In Absentia]]></title>
      <link>https://porcupinetree.com/album/in-absentia</link>
      <description><![CDATA[<p><strong>Release Date:</strong> September 24, 2002</p>]]></description>
      <pubDate>Tue, 24 Sep 2002 00:00:00 GMT</pubDate>
      <guid isPermaLink="false">porcupinetree-in-absentia-2002</guid>
    </item>
    
    <item>
      <title><![CDATA[Deadwing]]></title>
      <link>https://porcupinetree.com/album/deadwing</link>
      <description><![CDATA[<p><strong>Release Date:</strong> March 28, 2005</p>]]></description>
      <pubDate>Mon, 28 Mar 2005 00:00:00 GMT</pubDate>
      <guid isPermaLink="false">porcupinetree-deadwing-2005</guid>
    </item>
  </channel>
</rss>`

      const parser = new RSSParser()
      const feed = parser.parseXML(rssXML)

      expect(feed.title).toBe("Porcupine Tree Albums (1995-2005)")
      expect(feed.items).toHaveLength(7)
    })
  })

  describe("parseURL function", () => {
    const mockFetch = vi.fn()

    beforeEach(() => {
      mockFetch.mockClear()
    })

    it("should fetch and parse RSS feed", async () => {
      const rssXML = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>Porcupine Tree Albums (1995-2005)</title>
    <description>Complete discography of Porcupine Tree albums from 1995 to 2005</description>
    <link>https://porcupinetree.com</link>
    
    <item>
      <title><![CDATA[The Sky Moves Sideways]]></title>
      <link>https://porcupinetree.com/album/the-sky-moves-sideways</link>
      <description><![CDATA[<p><strong>Release Date:</strong> January 30, 1995</p>]]></description>
      <pubDate>Mon, 30 Jan 1995 00:00:00 GMT</pubDate>
      <guid isPermaLink="false">porcupinetree-the-sky-moves-sideways-1995</guid>
    </item>
    
    <item>
      <title><![CDATA[Signify]]></title>
      <link>https://porcupinetree.com/album/signify</link>
      <description><![CDATA[<p><strong>Release Date:</strong> September 30, 1996</p>]]></description>
      <pubDate>Mon, 30 Sep 1996 00:00:00 GMT</pubDate>
      <guid isPermaLink="false">porcupinetree-signify-1996</guid>
    </item>
    
    <item>
      <title><![CDATA[Stupid Dream]]></title>
      <link>https://porcupinetree.com/album/stupid-dream</link>
      <description><![CDATA[<p><strong>Release Date:</strong> March 22, 1999</p>]]></description>
      <pubDate>Mon, 22 Mar 1999 00:00:00 GMT</pubDate>
      <guid isPermaLink="false">porcupinetree-stupid-dream-1999</guid>
    </item>
    
    <item>
      <title><![CDATA[Lightbulb Sun]]></title>
      <link>https://porcupinetree.com/album/lightbulb-sun</link>
      <description><![CDATA[<p><strong>Release Date:</strong> May 22, 2000</p>]]></description>
      <pubDate>Mon, 22 May 2000 00:00:00 GMT</pubDate>
      <guid isPermaLink="false">porcupinetree-lightbulb-sun-2000</guid>
    </item>
    
    <item>
      <title><![CDATA[Recordings]]></title>
      <link>https://porcupinetree.com/album/recordings</link>
      <description><![CDATA[<p><strong>Release Date:</strong> June 18, 2001</p>]]></description>
      <pubDate>Mon, 18 Jun 2001 00:00:00 GMT</pubDate>
      <guid isPermaLink="false">porcupinetree-recordings-2001</guid>
    </item>
    
    <item>
      <title><![CDATA[In Absentia]]></title>
      <link>https://porcupinetree.com/album/in-absentia</link>
      <description><![CDATA[<p><strong>Release Date:</strong> September 24, 2002</p>]]></description>
      <pubDate>Tue, 24 Sep 2002 00:00:00 GMT</pubDate>
      <guid isPermaLink="false">porcupinetree-in-absentia-2002</guid>
    </item>
    
    <item>
      <title><![CDATA[Deadwing]]></title>
      <link>https://porcupinetree.com/album/deadwing</link>
      <description><![CDATA[<p><strong>Release Date:</strong> March 28, 2005</p>]]></description>
      <pubDate>Mon, 28 Mar 2005 00:00:00 GMT</pubDate>
      <guid isPermaLink="false">porcupinetree-deadwing-2005</guid>
    </item>
  </channel>
</rss>`

      mockFetch.mockResolvedValue(new Response(rssXML, { status: 200 }))

      const feed = await parseURL("https://example.com/feed.xml", mockFetch)

      expect(mockFetch).toHaveBeenCalledWith("https://example.com/feed.xml")
      expect(feed.title).toBe("Porcupine Tree Albums (1995-2005)")
      expect(feed.items).toHaveLength(7)
    })

    it("should handle fetch errors", async () => {
      mockFetch.mockRejectedValue(new Error("Network error"))

      await expect(parseURL("https://example.com/feed.xml", mockFetch)).rejects.toThrow(
        "Failed to parse RSS feed: Network error",
      )
    })

    it("should handle HTTP errors", async () => {
      mockFetch.mockResolvedValue(
        new Response("Not Found", { status: 404, statusText: "Not Found" }),
      )

      await expect(parseURL("https://example.com/feed.xml", mockFetch)).rejects.toThrow(
        "Failed to parse RSS feed: Failed to fetch RSS feed: 404 Not Found",
      )
    })
  })
})
