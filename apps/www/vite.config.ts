import { cloudflare } from "@cloudflare/vite-plugin"
import contentCollections from "@content-collections/remix-vite"
import { reactRouter } from "@react-router/dev/vite"
import tailwindcss from "@tailwindcss/vite"
import { defineConfig } from "vite"
import devtoolsJson from "vite-plugin-devtools-json"
import tsconfigPaths from "vite-tsconfig-paths"

export default defineConfig({
  plugins: [
    devtoolsJson(),
    cloudflare({ viteEnvironment: { name: "ssr" } }),
    tailwindcss(),
    reactRouter(),
    tsconfigPaths(),
    contentCollections(),
  ],
  resolve: {
    // better-auth's drizzle adapter is hoisted to the repo root while drizzle-orm
    // lives in this app's node_modules; without deduping, Vite can't resolve the
    // adapter's optional drizzle-orm peer and the SSR build fails to bundle
    // better-auth (e.g. "BetterAuthError is not exported").
    dedupe: ["drizzle-orm"],
  },
})
