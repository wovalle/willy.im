import { useState } from "react"

import type { Route } from "./+types/kit"
import { createPageMeta, siteConfig } from "~/static"
import { GitHubButton, Install, ProjectPage, projectLinks, REPO } from "./projects/shared"

const repo = `${REPO}/packages/kit`
const install = "npm install @willyim/kit zod"

export const links: Route.LinksFunction = projectLinks

const description =
  "Open-source TypeScript framework. Write a typed method once and serve it to your UI, an HTTP API with OpenAPI, MCP and AI agents, with permissions built in."

export const meta: Route.MetaFunction = () => [
  ...createPageMeta({
    title: "kit: TypeScript methods for your UI, HTTP API, MCP and AI agents",
    description,
    path: "/kit",
    image: `${siteConfig.url}/og/kit.png`,
    imageAlt: "kit: One method. Every surface.",
  }),
  {
    "script:ld+json": {
      "@context": "https://schema.org",
      "@type": "SoftwareSourceCode",
      name: "kit (@willyim/kit)",
      description,
      url: `${siteConfig.url}/kit`,
      codeRepository: repo,
      programmingLanguage: "TypeScript",
      runtimePlatform: ["Cloudflare Workers", "Node.js"],
      license: "https://opensource.org/licenses/MIT",
      author: { "@type": "Person", name: siteConfig.author, url: siteConfig.url },
    },
  },
]

const SURFACES = [
  {
    name: "UI",
    call: "ctx.services.notes.create({ title })",
    desc: <>React Router loaders and actions, in process and fully typed.</>,
  },
  {
    name: "HTTP",
    call: "POST /api/notes.create",
    desc: (
      <>
        Plus <code>/openapi.json</code> and <code>/llms.txt</code>, filtered per caller.
      </>
    ),
  },
  {
    name: "MCP",
    call: "toMcpServer(app, ctx)",
    desc: (
      <>
        The tool <code>notes_create</code>, with MCP Apps views when you want UI.
      </>
    ),
  },
  {
    name: "Agents",
    call: "tools(app, ctx)",
    desc: <>One neutral tool list for the Claude Agent SDK, AI SDK or anything else.</>,
  },
]

const PACKAGES = [
  [
    "@willyim/kit",
    <>
      Apps, services, methods, permissions, row policies, <code>tools()</code>, and the HTTP
      handler with OpenAPI 3.1 and <code>llms.txt</code>.
    </>,
  ],
  ["@willyim/kit/mcp", <>An MCP server from your app, with MCP Apps views.</>],
  ["@willyim/kit/react", <>Show or hide UI by the caller's grants.</>],
  [
    "@willyim/kit/idp",
    <>
      Login, API keys and bearer tokens through the <a href="/idp">willy.im IdP</a>.
    </>,
  ],
  ["@willyim/kit/log", <>Structured logs, one line per call by default.</>],
  ["@willyim/kit/audit", <>Semantic audit events, stored in D1 or Postgres.</>],
] as const

const METHODS = [
  { name: "notes.get", permission: "notes:read", summary: "Get one note by id" },
  { name: "notes.list", permission: "notes:read", summary: "List notes in the workspace" },
  { name: "notes.create", permission: "notes:write", summary: "Create a note" },
  { name: "notes.delete", permission: "notes:write", summary: "Delete a note" },
]

const CALLERS = {
  owner: {
    label: "Owner",
    grants: ["notes:read", "notes:write"],
    status: "200",
    ok: true,
    note: "Returns { id }, stripped to the output contract.",
  },
  viewer: {
    label: "Viewer",
    grants: ["notes:read"],
    status: "403",
    ok: false,
    note: "Missing notes:write. The method never ran.",
  },
  anonymous: {
    label: "No key",
    grants: null,
    status: "401",
    ok: false,
    note: "WWW-Authenticate: Bearer. No method names leak.",
  },
} as const

type CallerKey = keyof typeof CALLERS

function llmsTxt(caller: CallerKey) {
  const grants: readonly string[] | null = CALLERS[caller].grants
  const lines = ["GET /llms.txt", "", "# notes", "> Personal notes.", ""]
  if (!grants) return [...lines, "Methods are listed only for authenticated callers."].join("\n")

  const visible = METHODS.filter((m) => grants.includes(m.permission))
  return [...lines, "## Methods", ...visible.map((m) => `- ${m.name}: ${m.summary}`)].join("\n")
}

function PermissionsDemo() {
  const [caller, setCaller] = useState<CallerKey>("owner")
  const current = CALLERS[caller]

  return (
    <div className="demo">
      <div className="tabs" role="radiogroup" aria-label="Caller">
        {(Object.keys(CALLERS) as CallerKey[]).map((key) => (
          <button
            key={key}
            type="button"
            role="radio"
            aria-checked={caller === key}
            onClick={() => setCaller(key)}
          >
            {CALLERS[key].label}
          </button>
        ))}
      </div>
      <pre aria-live="polite">{llmsTxt(caller)}</pre>
      <div className="result">
        <code>POST /api/notes.create</code>
        <span className={current.ok ? "status ok" : "status err"}>{current.status}</span>
        <span className="note">{current.note}</span>
      </div>
    </div>
  )
}

export default function KitPage() {
  return (
    <ProjectPage
      name="kit"
      repo={repo}
      nav={[
        { href: "#permissions", label: "Permissions" },
        { href: "#packages", label: "Packages" },
      ]}
    >
      <main id="main-content" tabIndex={-1}>
        <div className="hero">
          <h1>
            One method.
            <br />
            Every surface.
          </h1>
          <p className="lede">
            Write a capability once as a typed method. Call it from your UI, your HTTP API, MCP and
            any agent, with permissions built into the contract.
          </p>
          <div className="actions">
            <GitHubButton href={repo} />
            <Install command={install} />
          </div>
          <div className="meta">
            <span>TypeScript + zod</span>
            <span>React Router, OpenAPI, MCP</span>
            <span>MIT</span>
          </div>
        </div>

        <section className="first">
          <pre className="code">
            <code>
              <span className="kw">export const</span> notes = declareService((ctx) =&gt; {"({"}
              {"\n  create: method(\n    {\n      summary: "}
              <span className="st">"Create a note"</span>
              {",\n      "}
              <span className="mark">
                permission: <span className="st">"notes:write"</span>
              </span>
              {",\n      input: { title: z.string() },\n      output: { id: z.string() },\n    },\n    "}
              <span className="kw">async</span>
              {" ({ title }) => ctx.notes.insert({ title }),\n  ),\n}))"}
            </code>
          </pre>

          <ul className="rows narrow" style={{ marginTop: "2rem" }}>
            {SURFACES.map((s) => (
              <li key={s.name}>
                <span className="name">{s.name}</span>
                <code className="call">{s.call}</code>
                <span className="desc">{s.desc}</span>
              </li>
            ))}
          </ul>
        </section>

        <section id="permissions" aria-labelledby="permissions-heading">
          <h2 id="permissions-heading">Permissions are part of the contract</h2>
          <p className="sub">
            Every method declares who may call it. kit checks it on every surface before your
            function runs, and discovery only lists what the caller can call, so a hidden method
            never reveals that it exists.
          </p>
          <PermissionsDemo />
        </section>

        <section id="packages" aria-labelledby="packages-heading">
          <h2 id="packages-heading">What ships in the package</h2>
          <p className="sub">One install. Each subpath is optional.</p>
          <table>
            <tbody>
              {PACKAGES.map(([name, what]) => (
                <tr key={name}>
                  <td>
                    <code>{name}</code>
                  </td>
                  <td>{what}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </main>

      <footer className="end">
        <h2>Try it</h2>
        <div className="actions">
          <GitHubButton href={repo} label="Read the README" />
          <Install command={install} />
        </div>
        <div className="colophon">
          <span>
            Built by <a href="/">Willy Ovalle</a>. Runs in production across his apps.
          </span>
          <span>MIT licensed</span>
        </div>
      </footer>
    </ProjectPage>
  )
}
