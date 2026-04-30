# browser-tool — User Guide

This is the guide for **consumers** of `browser-tool`: agents, scripts, or humans driving a browser through the library, CLI, or MCP server. For contributing to `browser-tool` itself, see [`developers.md`](./developers.md).

---

## What it does

`browser-tool` gives an LLM agent (or any caller) ten primitives for driving a real headless Chromium:

| Action | Purpose |
| --- | --- |
| `browser_navigate` | Open a URL. Returns a compact accessibility-tree snapshot. |
| `browser_snapshot` | Re-read the page after it changes. Returns the snapshot. |
| `browser_click` | Click an element by `@eN` ref. |
| `browser_type` | Type text into an input by `@eN` ref. |
| `browser_scroll` | Scroll the viewport up or down. |
| `browser_back` | Browser back. |
| `browser_press` | Press a key (Enter, Tab, Escape, etc.). |
| `browser_console` | Read accumulated logs/errors, or evaluate a JS expression. |
| `browser_get_images` | List `<img>` URLs on the page. |
| `browser_vision` | Screenshot the page and ask a vision model a question about it. |

It is **not** a general scraping library, a stealth browser, or a multi-frame DOM toolkit. v1 inspects the top frame only and runs a single shared Chromium process.

---

## When to reach for it

| Use it when | Use something else when |
| --- | --- |
| An agent needs to perform tasks on a website (forms, multi-step flows). | You need full-DOM scraping or static HTML extraction — use `fetch` + a parser. |
| You want one tool that any MCP client can drive. | You need stealth/anti-bot evasion — use a proper anti-detection stack. |
| You need lightweight, isolated browser sessions per task. | You need to handle iframes deeply — v1 doesn't traverse them. |
| You want vision + accessibility tree in one tool. | You're already invested in Playwright Test — you don't need this layer. |

---

## Install

```bash
bun install
bunx playwright install chromium    # ~170 MB, one-time
```

If you want the `vision` action, make sure an Anthropic-compatible API is reachable at `http://localhost:4000` (or configure `BROWSER_TOOL_VISION_BASE_URL`).

---

## The three surfaces

### 1. Importable Bun library

```ts
import {
  browserNavigate, browserSnapshot, browserClick, browserType,
  browserScroll, browserBack, browserPress, browserConsole,
  browserGetImages, browserVision,
  SessionManager,
} from "browser-tool";

const nav = await browserNavigate({ url: "https://example.com", taskId: "demo" });
if (!nav.success) throw new Error(nav.error);
console.log(nav.snapshot);

// Always close when you're done with all your sessions.
await SessionManager.getInstance().closeAll();
```

Every action returns an `ActionResult<T>`:

```ts
type ActionResult<T> =
  | ({ success: true } & T)
  | { success: false; error: string };
```

You almost always pattern-match on `success`. Don't try/catch — actions catch their own internals and surface failures via `success: false`.

### 2. CLI

```bash
bun run cli navigate --url https://example.com
bun run cli snapshot --task-id research
bun run cli click --ref @e3 --task-id research
bun run cli type --ref @e1 --text "hello world"
bun run cli console --expression "document.title"
bun run cli vision --question "What captcha is shown?"
```

- One JSON object on stdout per invocation.
- Exit code: `0` on `success: true`, `1` on `success: false`, `2` on usage error.
- Each invocation is one-shot — Chromium starts and exits with the command. Use the MCP server (or library) for multi-step interactive sessions.

### 3. MCP stdio server

```bash
bun run mcp
```

Registers ten tools (`browser_navigate`, `browser_snapshot`, …) over stdio. Wire it into Claude Code or any MCP client. Example Claude Code config snippet:

```jsonc
{
  "mcpServers": {
    "browser-tool": {
      "command": "bun",
      "args": ["run", "/absolute/path/to/browser-tool/src/mcp/server.ts"]
    }
  }
}
```

The server exposes `task_id` as a per-call argument on every tool, so a single server multiplexes many independent sessions.

---

## Mental model

### Sessions and `task_id`

A **session** is one isolated `BrowserContext` (its own cookie jar, storage, history) plus a primary `Page`. Sessions are keyed by `task_id`. Calling any action with the same `task_id` reuses the same session; different `task_id` gives a fresh, isolated context.

Defaults to `"default"`. You don't *need* a `task_id`, but use one whenever:

- An agent runs multiple browser tasks in parallel.
- You want a clean cookie state mid-conversation.
- You want one task's navigation history to be invisible to another.

```ts
await browserNavigate({ url: "https://github.com", taskId: "github-flow" });
await browserNavigate({ url: "https://gitlab.com", taskId: "gitlab-flow" });
// Two independent sessions; cookies don't leak between them.
```

Sessions are lazily created on first action and reaped after `BROWSER_INACTIVITY_TIMEOUT` seconds of inactivity (default 300). Always call `SessionManager.getInstance().closeAll()` before your process exits if you want immediate cleanup; the lifecycle handler does this on `SIGINT`/`SIGTERM`.

### Element refs (`@eN`)

Every snapshot tags interactive elements with sequential refs (`@e1`, `@e2`, …) and emits a text tree like:

```
page "Search Demo" url=http://example.com/
- banner
  - heading "Search Demo"
- main
  - form
    - textbox "Query" [ref @e1]
    - button "Search" [ref @e2]
  - paragraph "Welcome to the search demo."
  - link "About" [ref @e3]
```

Two rules:

1. **Refs are valid until the DOM changes.** A click that triggers a re-render or navigation invalidates them. After such an action, call `browser_snapshot` to refresh.
2. **`browser_navigate` includes a snapshot in its response** — you don't need a separate `snapshot` call right after navigating.

If you `click`/`type` on an unknown ref you get a clear error:
```
{ "success": false, "error": "Element @e9999 not found. Page may have changed; call browser_snapshot to refresh refs." }
```

### Compact vs full snapshots

```ts
await browserSnapshot({ taskId });               // compact (default)
await browserSnapshot({ full: true, taskId });   // full
```

- **Compact** — interactive elements + landmarks (`header`, `nav`, `main`, `aside`, `footer`, `section[aria-label]`, `form`, `article`). What an agent needs to act on the page.
- **Full** — also includes headings, paragraphs (truncated to 200 chars), and list items. Use when you need to read content, not just act on it.

Snapshots over 8000 characters (`BROWSER_MAX_SNAPSHOT_CHARS`) are truncated with a `[... N more lines truncated, M chars elided ...]` footer and `truncated: true` in the result.

### Vision

Use `browser_vision` when the accessibility tree is missing crucial information — captchas, charts, layout-dependent meaning, or content rendered as images.

```ts
const res = await browserVision({
  question: "Is there a CAPTCHA on this page? If so, what kind?",
  taskId: "vision-demo",
});
```

It takes a full-page screenshot, sends it to the configured vision model (default: `moonshotai/Kimi-K2.5`) along with your question, and returns the analysis text plus the screenshot path. Set `annotate: true` to overlay numbered red boxes on every `[data-agent-ref]` element before screenshotting (run a snapshot first to populate refs).

No API key is needed when the endpoint doesn't require authentication (e.g. localhost). Set `ANTHROPIC_API_KEY` or `BROWSER_TOOL_API_KEY` if the endpoint requires auth.

---

## Recipes

### Search → click → read result

```ts
const taskId = "search";
const nav = await browserNavigate({ url: "https://example.com/search", taskId });
if (!nav.success) throw new Error(nav.error);

// Pull refs out of the snapshot.
const inputRef  = nav.snapshot.match(/textbox[^\n]*\[ref @(e\d+)\]/)?.[1];
const submitRef = nav.snapshot.match(/button[^\n]*\[ref @(e\d+)\]/)?.[1];

await browserType({ ref: `@${inputRef}`, text: "browser tool", submit: true, taskId });
const after = await browserSnapshot({ full: true, taskId });
console.log(after.success && after.snapshot);
```

### Multi-step form fill

```ts
const taskId = "signup";
await browserNavigate({ url: "https://example.com/signup", taskId });

// Always snapshot after each step that mutates the DOM.
let snap = await browserSnapshot({ taskId });
const emailRef    = findRefByLabel(snap, "Email");
await browserType({ ref: emailRef, text: "alice@example.com", taskId });

snap = await browserSnapshot({ taskId });
const passwordRef = findRefByLabel(snap, "Password");
await browserType({ ref: passwordRef, text: "hunter2", taskId });

snap = await browserSnapshot({ taskId });
const submitRef   = findRefByText(snap, "Sign up");
await browserClick({ ref: submitRef, taskId });
```

(`findRefByLabel` and friends are helpers you write — the snapshot is plain text.)

### Read JS errors after a page interaction

```ts
const taskId = "qa";
await browserNavigate({ url: appUrl, taskId });
await browserClick({ ref: someButton, taskId });

const console_ = await browserConsole({ clear: false, taskId });
if (console_.success && "js_errors" in console_ && console_.js_errors.length) {
  console.error("page errors:", console_.js_errors);
}
```

### Evaluate JS in the page

```ts
const res = await browserConsole({ expression: "Array.from(document.querySelectorAll('a')).length", taskId });
if (res.success && "result" in res) console.log("link count:", res.result);
```

### Vision when the tree fails you

```ts
const v = await browserVision({
  question: "Look at the chart in the main panel. What's the highest data point and what date is it on?",
  taskId,
});
if (v.success) console.log(v.analysis);
```

---

## Configuration

`.env` is auto-loaded by Bun. All variables are optional.

| Variable | Default | What it does |
| --- | --- | --- |
| `BROWSER_TOOL_VISION_BASE_URL` | `http://localhost:4000/flex` | Base URL for the vision API (Anthropic SDK appends `/v1/messages` automatically). Change the path prefix to switch completion windows (e.g. `/asap`, `/standard`, `/priority`). |
| `BROWSER_TOOL_VISION_MODEL` | `moonshotai/Kimi-K2.5` | Override the vision model. |
| `BROWSER_TOOL_CACHE_DIR` | `~/.cache/browser-tool` | Where screenshots and runtime artifacts live. |
| `BROWSER_INACTIVITY_TIMEOUT` | `300` (seconds) | Idle session reaper threshold. |
| `BROWSER_REAPER_INTERVAL` | `30` (seconds) | How often the reaper checks. |
| `BROWSER_COMMAND_TIMEOUT` | `30` (seconds) | Per-action timeout for navigations and waits. |
| `BROWSER_MAX_SNAPSHOT_CHARS` | `8000` | Truncate snapshots above this size. |
| `BROWSER_TOOL_HEADLESS` | `1` | Set `0` to launch headed (debugging only). |
| `BROWSER_TOOL_DEBUG` | `0` | Set `1` for verbose stderr logs. |

---

## Limitations

- **Top frame only.** Iframes are walked into during snapshot generation but their elements are not currently tagged with refs. If you need to interact with iframe content, this isn't supported in v1.
- **One Chromium process per Bun/Node process.** Many sessions share one browser. If Chromium dies, all sessions die with it.
- **No persistent profiles.** Every session is ephemeral. Cookies/storage do not survive `closeAll()`.
- **Vision uses an Anthropic-compatible API endpoint.** No API key needed when the endpoint doesn't require auth (e.g. localhost).
- **Snapshot refs are recreated on every snapshot.** `@e3` from the snapshot you took two minutes ago is meaningless after the next snapshot — *always* use refs from the most recent snapshot.

---

## Troubleshooting

**"Element @eN not found"** — the page changed between your last snapshot and this action. Call `browser_snapshot` to refresh.

**Action hangs / times out** — check `BROWSER_COMMAND_TIMEOUT`. Default is 30 s. Pages that never fire `domcontentloaded` will hit it.

**Chromium fails to launch** — make sure you ran `bunx playwright install chromium`. On Linux with limited `/dev/shm`, the launch flags include `--disable-dev-shm-usage`; if you've added other flags, that may conflict.

**Vision call fails with connection error** — make sure an Anthropic-compatible API is reachable at `BROWSER_TOOL_VISION_BASE_URL` (default `http://localhost:4000/flex`).

**Sessions don't close on Ctrl-C in the MCP server** — they should; lifecycle handlers register `SIGINT`/`SIGTERM`. If your client wraps the server, make sure the wrapper forwards signals.
