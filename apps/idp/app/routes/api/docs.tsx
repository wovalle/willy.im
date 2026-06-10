export function meta() {
  return [{ title: "API docs · willy.im IdP" }]
}

/**
 * Renders the Scalar API reference against /api/openapi.json. The viewer is
 * loaded from a CDN so we don't bundle it.
 */
export default function ApiDocs() {
  return (
    <>
      <script
        id="api-reference"
        data-url="/api/openapi.json"
        // biome-ignore lint/security/noDangerouslySetInnerHtml: empty placeholder for Scalar
        dangerouslySetInnerHTML={{ __html: "" }}
      />
      <script src="https://cdn.jsdelivr.net/npm/@scalar/api-reference" />
    </>
  )
}
