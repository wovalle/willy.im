import { cloudflare } from "@cloudflare/vite-plugin"
import { reactRouter } from "@react-router/dev/vite"
import tailwindcss from "@tailwindcss/vite"
import { defineConfig } from "vite"
import tsconfigPaths from "vite-tsconfig-paths"

export default defineConfig({
  plugins: [
    cloudflare({ viteEnvironment: { name: "ssr" } }),
    tailwindcss(),
    reactRouter(),
    tsconfigPaths(),
  ],
  resolve: {
    // better-auth's drizzle adapter (hoisted to the repo root) declares drizzle-orm
    // as an optional peer. drizzle-orm is only in this app's node_modules, so without
    // deduping Vite can't resolve it from the adapter and stubs it out.
    dedupe: ["drizzle-orm"],
  },
})
