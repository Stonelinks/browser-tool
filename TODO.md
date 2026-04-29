# TODO

## Goal
Make browser-tool's vision feature use the Sail LLM proxy (localhost:4000) instead of calling Anthropic directly, defaulting to the `moonshotai/Kimi-K2.5` model.

## Tasks

### 1. Add Sail proxy config to `src/config.ts`
- [x] Add `visionBaseUrl` config (env `BROWSER_TOOL_VISION_BASE_URL`, default `http://localhost:4000/flex/v1`)
- [x] Add `visionApiKey` config (env `BROWSER_TOOL_VISION_API_KEY`, default `""` — proxy may not require auth)
- [x] Change default `visionModel` from `claude-haiku-4-5-20251001` to `moonshotai/Kimi-K2.5`

### 2. Update `src/vision/anthropic.ts` to use proxy via Anthropic SDK
- [x] Change `new Anthropic({ apiKey })` to `new Anthropic({ apiKey, baseURL: cfg.visionBaseUrl })` — proxy is transparent
- [x] Change env var check from `ANTHROPIC_API_KEY` to use `cfg.visionApiKey` (or allow passthrough when proxy doesn't need auth)
- [x] Keep the same `AnalyzeResult` interface and all existing logic

### 3. Update `src/schema.ts` vision tool description
- [x] Change description to mention Sail proxy instead of "Claude vision model"
- [x] Update `model` field description to mention the default model is `moonshotai/Kimi-K2.5`

### 4. Update `.env` file
- [x] Remove `ANTHROPIC_API_KEY`
- [x] Add `BROWSER_TOOL_VISION_BASE_URL=http://localhost:4000/flex/v1`
- [x] Add `BROWSER_TOOL_VISION_API_KEY=` (empty — proxy doesn't require auth on localhost)
- [x] Change/add `BROWSER_TOOL_VISION_MODEL=moonshotai/Kimi-K2.5`

### 5. Update tests
- [x] Update `test/vision.test.ts`: change "missing ANTHROPIC_API_KEY" test to check for missing config gracefully (no API key + no proxy)
- [x] Ensure mocked test still works with updated module

### 6. Update eval script
- [x] Update `eval/e2e.ts` step 8 to check for `BROWSER_TOOL_VISION_API_KEY` or equivalent instead of `ANTHROPIC_API_KEY`

### 7. Update documentation
- [x] Update `README.md`: change config table (remove ANTHROPIC_API_KEY, add new vars, change default model)
- [x] Update `docs/users.md`: replace Anthropic API key references with Sail proxy config, update model references
- [x] Update vision section descriptions to mention Sail proxy and Kimi-K2.5

## Notes
- The Sail proxy transparently supports the Anthropic SDK — just set `baseURL` to `http://localhost:4000/flex/v1` (or `/asap/v1`, `/standard/v1`, etc.) and it works.
- Using `flex` as the default base URL window since it's cheapest and vision calls aren't latency-critical for batch analysis. Users can override to `/asap/v1` for faster responses.
- `BROWSER_TOOL_VISION_API_KEY` is optional — the proxy typically has no `PROXY_API_KEY` on localhost. The Anthropic SDK requires *some* API key string, so we pass a placeholder when the env var is empty.
- `@anthropic-ai/sdk` stays as a dependency — no changes needed there.
