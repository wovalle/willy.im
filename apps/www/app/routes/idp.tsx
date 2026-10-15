import type { Route } from "./+types/idp"
import { createPageMeta, siteConfig } from "~/static"
import { GitHubButton, Install, ProjectPage, projectLinks, REPO } from "./projects/shared"

const repo = `${REPO}/apps/idp`

export const links: Route.LinksFunction = projectLinks

const description =
  "Free, open-source OAuth 2.1 and OpenID Connect provider on Cloudflare Workers and D1. Passkeys, workspaces, permission claims, API keys and MCP. Fork it."

export const meta: Route.MetaFunction = () => [
  ...createPageMeta({
    title: "idp: open-source OIDC provider on Cloudflare Workers",
    description,
    path: "/idp",
    image: `${siteConfig.url}/og/idp.png`,
    imageAlt: "idp: One identity. All your apps.",
  }),
  {
    "script:ld+json": {
      "@context": "https://schema.org",
      "@type": "SoftwareSourceCode",
      name: "idp",
      description,
      url: `${siteConfig.url}/idp`,
      codeRepository: repo,
      programmingLanguage: "TypeScript",
      runtimePlatform: "Cloudflare Workers",
      license: "https://www.mozilla.org/en-US/MPL/2.0/",
      author: { "@type": "Person", name: siteConfig.author, url: siteConfig.url },
    },
  },
]

const FEATURES = [
  {
    name: "Sign-in",
    title: "Magic links, one-time codes and passkeys",
    desc: "No passwords to store. Discord and other identities can be linked to the same account.",
  },
  {
    name: "One identity",
    title: "One user store, many apps",
    desc: "A person has a single identity across every app. Each app decides who gets in and what they can do.",
  },
  {
    name: "Workspaces",
    title: "Per-app workspaces and roles in the token",
    desc: "The token lists every workspace the user has in the requesting app, and never one from another app.",
  },
  {
    name: "Permissions",
    title: "A permission catalog per app",
    desc: "Apps declare their permissions. The IdP resolves each user's grants, down to a single resource like one thread, and emits them as a claim.",
  },
  {
    name: "API keys",
    title: "Scoped keys for machines",
    desc: "Keys carry the same permissions model as tokens, so apps can drop their own key systems.",
  },
  {
    name: "Management API",
    title: (
      <>
        HTTP, OpenAPI and MCP, built on <a href="/kit">kit</a>
      </>
    ),
    desc: "Every console action is one method, so an agent can provision apps, users and workspaces with a key.",
  },
  {
    name: "Console",
    title: "Admin console for apps, users and members",
    desc: "Invitations, secret rotation, impersonation and an audit log of every change.",
  },
  {
    name: "Custom domains",
    title: "Your app's own sign-in domain",
    desc: "Serve the IdP from idp.yourapp.com so its session cookie stays first-party.",
  },
]

const ROADMAP = {
  built: [
    "Email and passkey sign-in",
    "OIDC provider and discovery",
    "Workspaces and role claims",
    "Permission catalogs and resource grants",
    "API keys and management keys",
    "Admin console, audit, impersonation",
    "Custom domains",
  ],
  wip: ["Per-app user metadata"],
  later: ["Profile editing in one place", "MFA", "Organizations", "SAML and SCIM"],
}

const TOKEN = `{
  "iss": "https://idp.willy.im/auth",
  "sub": "usr_8f2c1a",
  "email": "ada@example.com",
  "picture": "https://idp.willy.im/avatar/usr_8f2c1a",
  "https://willy.im/workspaces": [
    { "id": "ws_acme", "role": "admin" }
  ],
  "permissions": [
    "notes:read",
    "notes:write",
    "kirby:thread:t_14f451b6"
  ]
}`

function SignInBox() {
  return (
    <div className="signin" aria-hidden="true">
      <div className="app">
        <span className="logo">N</span>
        Sign in to Notes
      </div>
      <label>Email</label>
      <div className="field">ada@example.com</div>
      <span className="btn btn-dark">Email me a link</span>
      <div className="or">or</div>
      <span className="btn btn-line">Use a passkey</span>
      <p className="fine">Secured by willy.im</p>
    </div>
  )
}

export default function IdpPage() {
  return (
    <ProjectPage
      name="idp"
      repo={repo}
      nav={[
        { href: "#features", label: "Features" },
        { href: "#self-host", label: "Self-host" },
      ]}
    >
      <main id="main-content" tabIndex={-1}>
        <div className="hero">
          <h1>
            One identity.
            <br />
            All your apps.
          </h1>
          <p className="lede">
            An open-source OAuth 2.1 and OpenID Connect provider on Cloudflare Workers. Your apps
            add “Sign in with willy.im” and delete their account code.
          </p>
          <div className="actions">
            <GitHubButton href={repo} />
            <a className="btn btn-line" href="https://idp.willy.im">
              See it live
            </a>
          </div>
          <div className="meta">
            <span>Free and open source</span>
            <span>Cloudflare Workers + D1</span>
            <span>MPL-2.0</span>
          </div>
        </div>

        <section className="first">
          <div className="pair">
            <SignInBox />
            <div>
              <pre className="code">
                <code>{TOKEN}</code>
              </pre>
              <p className="caption">The ID token Notes gets back. Example values.</p>
            </div>
          </div>
        </section>

        <section id="features" aria-labelledby="features-heading">
          <h2 id="features-heading">Everything an app would otherwise build</h2>
          <p className="sub">
            Authentication is central. Authorization stays with each app, fed by claims the IdP
            resolves.
          </p>
          <ul className="rows">
            {FEATURES.map((f) => (
              <li key={f.name}>
                <span className="name">{f.name}</span>
                <h3>{f.title}</h3>
                <span className="desc">{f.desc}</span>
              </li>
            ))}
          </ul>
        </section>

        <section id="client" aria-labelledby="client-heading">
          <h2 id="client-heading">Add it to an app</h2>
          <p className="sub">
            <code>@willyim/idp</code> is the client: OIDC, server sessions and React Router guards.
            Its only runtime dependency is zod, and it runs on Workers, Node and Bun.
          </p>
          <pre className="code">
            <code>
              <span className="kw">import</span> {"{ createIdp } "}
              <span className="kw">from</span> <span className="st">"@willyim/idp"</span>
              {"\n"}
              <span className="kw">import</span> {"{ drizzleSessions } "}
              <span className="kw">from</span> <span className="st">"@willyim/idp/drizzle"</span>
              {"\n\n"}
              <span className="kw">export const</span>
              {" idp = createIdp({\n  issuer: "}
              <span className="st">"https://idp.willy.im/auth"</span>
              {
                ",\n  clientId: env.IDP_CLIENT_ID,\n  clientSecret: env.IDP_CLIENT_SECRET,\n  sessions: drizzleSessions(db, schema.idpSession),\n  session: { secret: env.SESSION_SECRET, expiresIn: "
              }
              <span className="st">"30d"</span>
              {" },\n})"}
            </code>
          </pre>
          <div className="actions" style={{ marginTop: "1.5rem" }}>
            <Install command="npm install @willyim/idp" />
          </div>
        </section>

        <section id="self-host" aria-labelledby="self-host-heading">
          <h2 id="self-host-heading">Run your own</h2>
          <p className="sub">
            No plans, no seats, no tiers. Fork it and it's yours. The whole IdP is one Worker and
            one D1 database.
          </p>
          <ol className="steps">
            <li>
              <h3>Fork the repository</h3>
              <div className="desc">
                The IdP lives in <code>apps/idp</code>.
              </div>
            </li>
            <li>
              <h3>Create a D1 database</h3>
              <div className="desc">
                Point <code>wrangler.jsonc</code> at it, then apply the migrations.
                <pre className="code">
                  <code>{"wrangler d1 create idp\nnpm run db:migrate-prod --workspace=idp"}</code>
                </pre>
              </div>
            </li>
            <li>
              <h3>Deploy</h3>
              <div className="desc">
                <pre className="code">
                  <code>npm run deploy --workspace=idp</code>
                </pre>
              </div>
            </li>
          </ol>
        </section>

        <section id="roadmap" aria-labelledby="roadmap-heading">
          <h2 id="roadmap-heading">Roadmap</h2>
          <p className="sub">It already runs sign-in for the apps on willy.im.</p>
          <div className="roadmap">
            <div>
              <h3>
                <span className="dot" /> Shipped
              </h3>
              <ul>
                {ROADMAP.built.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
            <div>
              <h3>
                <span className="dot wip" /> In progress
              </h3>
              <ul>
                {ROADMAP.wip.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
            <div>
              <h3>
                <span className="dot later" /> Later
              </h3>
              <ul>
                {ROADMAP.later.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
          </div>
        </section>
      </main>

      <footer className="end">
        <h2>Fork it</h2>
        <div className="actions">
          <GitHubButton href={repo} label="Read the README" />
          <a className="btn btn-line" href="https://idp.willy.im">
            See it live
          </a>
        </div>
        <div className="colophon">
          <span>
            Built by <a href="/">Willy Ovalle</a>. Pairs with <a href="/kit">kit</a>.
          </span>
          <span>MPL-2.0</span>
        </div>
      </footer>
    </ProjectPage>
  )
}
