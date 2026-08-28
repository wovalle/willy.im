/**
 * Luchy analytics — the constants shared with the browser.
 *
 * This module is imported by `root.tsx`, so it must stay free of server-only
 * code. The browser script auto-tracks pageviews, outbound links and
 * `data-luchy-event` clicks; everything the server derives lives in
 * `luchy.server.ts`.
 */

/** Public ingest key — it ships in the HTML for the browser script too. */
export const LUCHY_API_KEY = "f7060145b46b4668a609b2c6b79c04a3"
export const LUCHY_ENDPOINT = "https://dash.luchy.app/api/ingest"
export const LUCHY_SCRIPT_SRC = "https://cdn.luchy.app/luchy.min.js"
