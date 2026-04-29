# browser-tool — Developer Guide

This guide is for **contributors** to `browser-tool`. For consumers driving the tool, see [`users.md`](./users.md).

---

## Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│  consumers                                                       │
│  ┌────────────┐    ┌────────────┐    ┌────────────────┐          │
│  │  library   │    │    CLI     │    │  MCP server    │          │
│  │  src/      │    │ src/cli/   │    │   src/mcp/     │          │
│  │  index.ts  │    │  main.ts   │    │   server.ts    │          │
│  └─────┬──────┘    └─────┬──────┘    └───────┬────────┘          │
│        │                 │                   │                   │
│        └─────────────────┴───────────────────┘                   │
│                          │                                       │
│                          ▼                                       │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │  src/schema.ts  — TOOL_SPECS (single source of truth)       │ │
│  │  one zod schema + handler per action; CLI/MCP read this    │  │
│  └────────────────────────────────────────────────────────────┘  │
│                          │                                       │
│                          ▼                                       │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │  src/actions/*.ts  — 10 action implementations             │  │
│  │  each: input validation → withSession → page operation     │  │
│  └────────────────────────────────────────────────────────────┘  │
│                          │                                       │
│                          ▼                                       │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │  src/session/manager.ts  — singleton SessionManager        │  │
│  │  one Browser, N BrowserContexts (one per task_id)          │  │
│  │  lazy launch, idle reaper, signal handlers                 │  │
│  └────────────────────────────────────────────────────────────┘  │
│                          │                                       │
│                          ▼                                       │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │  playwright-core  →  headless Chromium                     │  │
│  └────────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────┘
```

Three principles:

1. **One source of truth for the tool schema.** `src/schema.ts::TOOL_SPECS` is a list of `{ name, description, inputSchema (zod), handler }`. The CLI builds option tables from it, the MCP server registers tools from it, and tests call handlers through it. Adding an action means adding one entry here.
2. **Library is the core.** CLI and MCP are thin wrappers. Both go through the same handlers; both produce the same JSON shapes.
3. **Sessions are isolation, not identity.** `task_id` selects which `BrowserContext` an action runs in. Contexts are cheap (single Chromium process, many contexts). One context = one cookie jar, one storage, one history.

---

## Code map

```
src/
├── index.ts                  Public library exports
├── types.ts                  ActionResult<T>, per-action result interfaces
├── schema.ts                 zod schemas + TOOL_SPECS (single source of truth)
├── config.ts                 Env-driven Config; getConfig()/resetConfig()
├── logger.ts                 logDebug/logError to stderr
├── session/
│   ├── manager.ts            SessionManager singleton
│   ├── session.ts            Session: BrowserContext + Page + buffers
│   └── lifecycle.ts          SIGINT/SIGTERM/beforeExit handlers
├── snapshot/
│   ├── injected.ts           snapshotScript() — runs INSIDE the page
│   ├── snapshot.ts           buildSnapshot() — orchestrator
│   └── truncate.ts           Cap snapshot text size
├── actions/
│   ├── _helpers.ts           withSession(), refSelector(), failure()
│   ├── navigate.ts │ snapshot.ts │ click.ts │ type.ts │ scroll.ts
│   ├── back.ts │ press.ts │ console.ts │ getImages.ts │ vision.ts
├── vision/
│   └── anthropic.ts          analyzeScreenshot() — Claude vision call
├── cli/
│   └── main.ts               CLI: node:util.parseArgs, exit codes
└── mcp/
    └── server.ts             MCP stdio server (@modelcontextprotocol/sdk)

test/
├── fixtures/                 form.html, scroll.html, images.html, console.html, server.ts
├── helpers.ts                useFixtureServer(), findFirstRef()
└── *.test.ts                 9 integration test files
eval/
└── e2e.ts                    8-step end-to-end PASS/FAIL with live vision call
```

---

## The snapshot algorithm

This is the most non-obvious part of the codebase. The text snapshot you see (with `[ref @e1]` markers) is built from a single in-page `evaluate()` call.

### Element discovery

`src/snapshot/injected.ts` exports `snapshotScript()`, a function whose source is serialized and run inside the browser's V8 sandbox. It walks `document.body` via `TreeWalker` and classifies each element as:

- **Interactive** — gets a ref. Trigger conditions:
  - `tagName ∈ {A, BUTTON, INPUT, TEXTAREA, SELECT, OPTION, SUMMARY, DETAILS, LABEL}` (with `INPUT[type=hidden]` excluded);
  - or `role ∈ {button, link, textbox, checkbox, radio, switch, menuitem, tab, option, combobox, searchbox, slider}`;
  - or `tabindex >= 0`;
  - or `contenteditable=true`;
- **Structural** — landmark/region. `HEADER, NAV, MAIN, ASIDE, FOOTER, SECTION, ARTICLE, FORM`. Always included; never given a ref.
- **Textual** — `H1–H6, P, LI`. Included only when `compact=false`.

An element must also be **visible** (`offsetParent !== null` OR positive bounding box) to be tagged. `<option>` elements are special-cased — they have no offsetParent but are visible if their parent `<select>` is visible.

Hidden, off-screen, or zero-size elements are walked through (their children may be visible) but not emitted.

### Why `data-agent-ref="N"` on the DOM

Refs aren't stored in JS — they're set as **DOM attributes** on each interactive element:

```js
el.setAttribute("data-agent-ref", String(refCounter++));
```

This is deliberate. `ElementHandle` references are fragile (they detach on navigation, re-render, or even DOM mutation). Setting an attribute means the next click resolves trivially:

```ts
session.page.locator(`[data-agent-ref="5"]`).first().click();
```

…and survives most DOM mutations. The next snapshot wipes prior `data-agent-ref` attributes and starts the counter at 1 again, so refs are local to the most recent snapshot. This matches user expectation: "the snapshot you just took is the source of truth for what `@e3` means right now."

### The text format

Each emitted node is one indented line:

```
${"  ".repeat(depth)}- ${role} "${name}" [ref @e${n}]${stateSuffix}
```

- `role` — explicit `aria-role`, or derived from the tag (`A` → `link`, `BUTTON` → `button`, `INPUT[type=text]` → `textbox`, etc.).
- `name` — the accessible name. Falls back through `ariaLabel` → `aria-labelledby` → `<label for=>` → `placeholder` → `value` → text content (capped at 120 chars).
- `stateSuffix` — `[disabled, checked, expanded=true, selected, ...]` when applicable.

The first line is always a `page "<title>" url=<url>` header.

### Compact vs full

- **Compact** (default): only landmarks and interactive elements. Optimized for an agent that wants to *act*, not *read*.
- **Full**: also includes headings, paragraphs (capped at 200 chars), and list items. Use when the agent needs to read prose content.

### Truncation

`src/snapshot/truncate.ts` caps the rendered text at `BROWSER_MAX_SNAPSHOT_CHARS` (default 8000). It cuts at the last newline before the cap and appends `[... N more lines truncated, M chars elided ...]`. Truncation never breaks a `[ref @eN]` marker because we cut on line boundaries.

### Iframes

**Out of scope for v1.** The injected script runs in the main world only. Iframe content is not tagged. To add iframe support: iterate `page.frames()` in `buildSnapshot`, run the injected script per frame, and prefix refs with the frame index (`@e1.2`). Not hard, just hasn't been done.

---

## Session lifecycle

### Singleton + lazy launch

`SessionManager.getInstance()` returns the process-wide singleton. The Chromium browser is launched on the **first** `getOrCreate(taskId)` call, not when the manager is created. Subsequent `getOrCreate` calls reuse the same browser.

```ts
private async ensureBrowser(): Promise<Browser> {
  if (this.browser && this.browser.isConnected()) return this.browser;
  if (!this.launchPromise) this.launchPromise = chromium.launch({...});
  this.browser = await this.launchPromise;
  this.launchPromise = null;
  return this.browser;
}
```

The `launchPromise` deduplicates concurrent launches. The `creating: Map<taskId, Promise<Session>>` in `getOrCreate` does the same for sessions — if two callers ask for `task_id=X` at the same time, only one context is created.

### Idle reaper

`startIdleReaper()` sets an unref'd `setInterval` that closes any session whose `lastActivityAt` is older than `BROWSER_INACTIVITY_TIMEOUT`. It's started lazily on the first session creation. Every action calls `session.touch()` to bump the timestamp.

### Shutdown

`registerLifecycleHandlers()` (in `src/session/lifecycle.ts`) installs:

- `SIGINT` → `closeAll()` then `process.exit(130)`
- `SIGTERM` → `closeAll()` then `process.exit(143)`
- `beforeExit` → `closeAll()` (best-effort; not always reliable for long-running stdio servers)
- `uncaughtException` → log + `closeAll()` + `process.exit(1)`

The closure is idempotent (`shuttingDown` flag), and each `closeAll` is wrapped in a 5 s timeout so a hung Chromium doesn't block exit.

The CLI registers handlers and *also* explicitly calls `closeAll()` in its `finally` block before `process.exit()`. The MCP server registers handlers and relies on signals.

### `closeAllSessions()` vs `closeAll()`

- `closeAllSessions()` — closes every `BrowserContext` (per-session), keeps the browser alive. Used in tests between cases for speed.
- `closeAll()` — closes contexts, then the browser, then nulls everything. Used at process exit.

---

## Adding a new action

Walk through the three places you need to touch:

### 1. Implement the action

Create `src/actions/myAction.ts`:

```ts
import { withSession, failure, errorMessage } from "./_helpers.js";
import type { ActionResult } from "../types.js";

export interface MyActionInput {
  some_arg: string;
  taskId?: string;
}

export interface MyActionResult {
  // shape of the success payload
}

export async function browserMyAction(
  input: MyActionInput,
): Promise<ActionResult<MyActionResult>> {
  if (!input.some_arg) return failure("some_arg is required");
  return withSession(input.taskId, async (session) => {
    try {
      // do something with session.page
      return { success: true, /* ... */ } as ActionResult<MyActionResult>;
    } catch (err) {
      return failure(`my_action failed: ${errorMessage(err)}`);
    }
  });
}
```

Conventions:
- Return `failure(message)` for input/runtime errors. Never throw at the boundary — actions catch their own errors.
- Use `withSession(taskId, fn)` to get the active session and auto-touch its activity timestamp.
- Keep `taskId` as the *last* property in the input interface, optional, defaulting to `"default"` via `withSession`.

### 2. Add a zod schema + TOOL_SPEC entry

In `src/schema.ts`:

```ts
export const MyActionSchema = z.object({
  some_arg: z.string().describe("What this argument is for."),
  task_id: taskId,
});

// in TOOL_SPECS:
{
  name: "browser_my_action",
  description: "What this action does. Be concise — agents read this.",
  inputSchema: MyActionSchema,
  handler: adapt(MyActionSchema, (a) =>
    browserMyAction({ some_arg: a.some_arg, taskId: a.task_id }),
  ),
},
```

The `adapt()` helper does input validation (returning a clean `Invalid arguments: ...` failure on bad input) and forwards to the action.

### 3. Wire into the library and CLI

In `src/index.ts`, re-export:

```ts
export { browserMyAction, type MyActionInput } from "./actions/myAction.js";
```

In `src/cli/main.ts`, add to `ACTION_TO_TOOL`:

```ts
"my-action": "browser_my_action",
```

The CLI builds its `parseArgs` option table from the zod schema's shape automatically — no further wiring needed for primitive args.

### 4. Test it

Create `test/myAction.test.ts`:

```ts
import { test, expect } from "bun:test";
import { browserMyAction, browserNavigate } from "../src/index.js";
import { useFixtureServer } from "./helpers.js";

const ctx = useFixtureServer();

test("my action does the thing", async () => {
  const taskId = "my-action-1";
  await browserNavigate({ url: `${ctx.url()}/form.html`, taskId });
  const res = await browserMyAction({ some_arg: "x", taskId });
  expect(res.success).toBe(true);
});
```

---

## Testing

### Fixture server

`test/fixtures/server.ts::startFixtureServer()` spins up a `Bun.serve({ port: 0 })` (random port) that serves the static HTML files in `test/fixtures/` and synthesizes a `/results` and `/about` page. No internet dependency; deterministic across runs.

### `useFixtureServer()` pattern

```ts
const ctx = useFixtureServer();    // registers beforeAll/afterAll/afterEach

test("...", async () => {
  await browserNavigate({ url: `${ctx.url()}/form.html`, taskId: "x" });
});
```

`useFixtureServer` captures its fixture handle in a **closure**, not a module-level variable. This matters: `bun test --parallel` runs each test file in a separate worker process by default, but module-level state is still per-file within a worker; the closure pattern keeps state cleanly per-test-file even if you change parallelism settings later.

`afterEach` calls `closeAllSessions()` (not `closeAll()`) — keeps the shared browser alive between tests in a file for speed (~6 s for the full suite vs ~30 s if we relaunched per test).

`afterAll` calls full `closeAll()` plus `fixtures.stop()`.

### Why `--parallel`

Run with `bun test --parallel` (the `bun run test` script does this for you). Each test file gets its own worker process, so the `SessionManager` singleton is per-file. Without `--parallel`, all files share one singleton and one Chromium — that path has worked in the past but is more fragile (the singleton's `creating` and `launchPromise` maps interact across files in subtle ways). Default is parallel; keep it that way.

### Mocking the Anthropic SDK

`test/vision.test.ts` uses Bun's `mock.module()` to replace `src/vision/anthropic.js` before the action under test imports it:

```ts
await mock.module("../src/vision/anthropic.js", () => ({
  analyzeScreenshot: async () => ({
    success: true, analysis: "...", model: "mock",
  }),
}));
```

Order matters: replace the module **before** importing the action. Each call to `mock.module` is per-test and gets restored via `mock.restore()` in `finally`.

### MCP smoke test

`test/mcp_smoke.test.ts` spawns the real MCP server with `Bun.spawn(...)`, sends `initialize` → `notifications/initialized` → `tools/list` → `tools/call`, parses JSON-RPC responses from stdout, and asserts on shape.

Bun's spawn stdin is a `FileSink` (not a Web `WritableStream`); use `stdin.write(...)` and `stdin.flush()`. stdout is a Web `ReadableStream<Uint8Array>` and works with the standard reader API.

### What's covered

| File | Coverage |
| --- | --- |
| `navigate.test.ts` | success + bad URL + URL normalization |
| `snapshot.test.ts` | compact has refs but skips paragraphs; full includes them |
| `click_type.test.ts` | type → click → results; bad ref error; type+submit; numeric ref form |
| `scroll_back_press.test.ts` | scroll up/down; back; press Tab moves focus |
| `console.test.ts` | logs/errors buffered; clear empties; expression eval |
| `getImages.test.ts` | http(s) images returned; data: URLs skipped |
| `session_lifecycle.test.ts` | task isolation; idle reaper closes stale sessions |
| `vision.test.ts` | no-API-key error path; mocked SDK happy path |
| `mcp_smoke.test.ts` | full MCP handshake + tools/list + tools/call + zod-error path |

---

## Eval

`eval/e2e.ts` is a deterministic 8-step end-to-end check. Steps 1–7 run against a local fixture server (no internet); step 8 makes a **real Anthropic Claude vision call** using the API key from `.env`. Output:

```
EVAL PASS (8/8 steps)         # exit 0
EVAL FAIL (N/8 steps)         # exit 1 with per-step details
```

This is the user's hard requirement before declaring the project shippable. Run it after any non-trivial change.

---

## Local development

```bash
# Setup
bun install
bunx playwright install chromium

# Iterate
bun run typecheck                  # tsc --noEmit
bun run test                       # all tests, ~6s
bun test --timeout 30000 --parallel test/snapshot.test.ts   # one file
bun run eval                       # end-to-end, includes live Anthropic call

# Smoke
bun run cli navigate --url https://example.com
bun run mcp                        # then send JSON-RPC over stdin
```

### Debugging

- `BROWSER_TOOL_DEBUG=1` enables `logDebug()` lines on stderr (session lifecycle, launch events).
- `BROWSER_TOOL_HEADLESS=0` launches headed Chromium — useful for watching what's happening.
- `BROWSER_INACTIVITY_TIMEOUT=10` shortens the reaper to 10 s so you can verify it's behaving.
- For snapshot debugging, the easiest path is `bun run cli snapshot --json-pretty` after a navigate.

---

## Common pitfalls

- **Don't store `ElementHandle`s.** They detach on re-render. Always re-resolve via `page.locator('[data-agent-ref="N"]')` from a fresh snapshot.
- **Don't add module-level mutable state in test helpers.** Use closures. Two test files importing the same helper will overwrite each other's state.
- **Don't bypass `withSession`.** It's where activity tracking happens; if you skip it, the idle reaper can close the session under you mid-action.
- **Don't `console.log` in `src/`.** Use `logDebug()`/`logError()` (stderr only). Stdout in the MCP server is the JSON-RPC channel; one stray log corrupts the protocol.
- **Don't add new dependencies casually.** The current dep tree is five runtime packages. Each one we add is a long-term maintenance cost for a tool meant to be embedded.

---

## Future work

- **Iframes.** Walk `page.frames()` and merge per-frame snapshots with prefixed refs.
- **Persistent profiles.** `chromium.launchPersistentContext(userDataDir)` for sessions that survive process restarts.
- **More vision models.** Pluggable backend for OpenAI / Gemini in addition to Anthropic.
- **Snapshot summarization.** When truncation kicks in, optionally summarize via an auxiliary LLM (the Python tool does this).
- **Tab management.** Today we operate on `session.page` only; multi-tab flows would need a tab index / explicit switching.
