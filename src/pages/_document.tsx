import Document, { Html, Head, Main, NextScript } from "next/document"

class NextDocument extends Document {
  render() {
    return (
      <Html lang="en">
        <Head>
          <meta httpEquiv="X-UA-Compatible" content="IE=edge" />
          <meta name="keywords" content="willy,ovalle,willyovalle,wovalle,personal,site" />
          <meta property="og:image" content="/android-chrome-512x512.png" />
          <link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png" />
          <link rel="icon" type="image/png" sizes="32x32" href="/favicon-16x16.png" />
          <link rel="icon" type="image/png" sizes="16x16" href="/favicon-32x32.png" />
          <link rel="manifest" href="/site.webmanifest" />
          <link rel="preconnect" href="https://fonts.gstatic.com" />
          <link rel="stylesheet" href="//fonts.googleapis.com/css2?family=Lato&display=swap" />
          <meta charSet="utf-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1" />
        </Head>
        <body className="bg-white dark:bg-black">
          <Main />
          <NextScript />
        </body>
      </Html>
    )
  }
}

export default NextDocument