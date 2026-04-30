# browser-tool

A standalone Bun + TypeScript browser-control tool for LLM agents. Drives a headless Chromium via Playwright and exposes 10 actions (navigate, snapshot, click, type, scroll, back, press, console, get-images, vision) through three surfaces:

1. **Importable Bun library** — `import { browserNavigate } from "browser-tool"`
2. **CLI** — `browser-tool navigate --url https://example.com`
3. **MCP stdio server** — `bun run mcp` (drop-in for Claude Code, Claude Desktop, etc.)

Ported from the local-Chromium mode of `hermes-agent/tools/browser_tool.py`. No external CLI dependency — uses `playwright-core` directly.

## Install

```bash
bun install
bunx playwright install chromium    # ~170 MB, one-time
```

## Use

### Library

```ts
import { browserNavigate, browserSnapshot, browserClick, browserType } from "browser-tool";

const nav = await browserNavigate({ url: "https://example.com", taskId: "my-task" });
if (nav.success) console.log(nav.snapshot);  // contains [ref @e1] markers

const snap = await browserSnapshot({ taskId: "my-task" });
await browserClick({ ref: "@e3", taskId: "my-task" });
await browserType({ ref: "@e1", text: "hello", taskId: "my-task" });
```

### CLI

```bash
bun run cli navigate --url https://example.com
bun run cli snapshot --task-id my-task
bun run cli click --ref @e3 --task-id my-task
bun run cli type --ref @e1 --text "hello"
bun run cli console --expression "document.title"
bun run cli vision --question "What's on this page?"
```

Output is a single line of JSON on stdout. Exit code: `0` success, `1` action error, `2` usage error.

### MCP server

```bash
bun run mcp     # stdio server, register with your agent's MCP config
```

Registers 10 tools, each accepting an optional `task_id` argument so a single server can drive multiple isolated browser sessions.

## Configuration

`.env` is auto-loaded by Bun. Supported variables:

| Variable | Default | Purpose |
| --- | --- | --- |
| `BROWSER_TOOL_VISION_BASE_URL` | `http://localhost:4000/flex` | Base URL for vision API (Anthropic SDK appends `/v1/messages`). |
| `BROWSER_TOOL_VISION_MODEL` | `moonshotai/Kimi-K2.5` | Override vision model |
| `BROWSER_TOOL_CACHE_DIR` | `~/.cache/browser-tool` | Where screenshots live |
| `BROWSER_INACTIVITY_TIMEOUT` | `300` (seconds) | Idle session reaper threshold |
| `BROWSER_TOOL_HEADLESS` | `1` | Set `0` to launch headed (debugging) |
| `BROWSER_TOOL_DEBUG` | `0` | Set `1` for verbose stderr logs |

## Development

```bash
source env.sh           # sets up PATH so bin/* scripts are available
check                  # runs format + typecheck + test + integration tests
format                 # format TS and shell files
typecheck              # tsc --noEmit
test                   # bun test (unit tests)
test-integration       # exercises library, CLI, and MCP entrypoints
```

Prefer `bin/*` scripts over `bun run` npm scripts. See [`docs/developers.md`](./docs/developers.md) for details.

## Limitations

- v1: top frame only (no iframe traversal).
- v1: single Chromium instance per process; sessions isolated by `BrowserContext`.
- Vision routes through a configurable Anthropic-compatible endpoint; no API key needed on localhost.

## Detailed docs

- [`docs/users.md`](./docs/users.md) — guide for consumers: mental model, recipes, full configuration reference, troubleshooting.
- [`docs/developers.md`](./docs/developers.md) — guide for contributors: architecture, snapshot algorithm, session lifecycle, how to add a new action, testing strategy.
