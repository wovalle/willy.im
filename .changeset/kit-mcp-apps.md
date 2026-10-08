---
"@willyim/kit": minor
---

MCP Apps: `createApp({ views })` declares HTML views and a contract's `ui: { view, visibility? }` renders a method's result in one. `toMcpTool` emits `_meta.ui.resourceUri` (`ui://<app>/<view>`) and `visibility`; `toMcpServer` serves the caller's views through `resources/list` and `resources/read` as `text/html;profile=mcp-app`; `KitTool.ui` passes the view through to other runtimes. An unknown view fails at `createApp`, in types and at run time.
