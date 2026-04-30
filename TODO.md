# TODO

## Goal
Adapt the sailresearch-proxy `bin/` + `env.sh` pattern to browser-tool, giving us `check`, `format`, `format-ts`, `format-shell`, `typecheck`, `test`, and `test-integration` scripts that run formatting, type checking, unit tests, and integration/E2E tests.

## Tasks

### 1. Add prettier as a devDependency
- [x] Add `prettier` to `devDependencies` in `package.json`
- [x] Run `bun install` to update lockfile

### 2. Create `env.sh`
- [x] Create `env.sh` at project root (sourced, not executed) that sets `PROJECT_ROOT`, adds `bin/` and `node_modules/.bin` to `PATH`, and makes `bin/*` executable

### 3. Create `bin/format-ts`
- [x] Format TS files with `prettier --write 'src/**/*.ts'` (accept optional file args)

### 4. Create `bin/format-shell`
- [x] Auto-detect bash scripts from git tracked/untracked files (first-line `bash` check) and run `shfmt -l -w` on them

### 5. Create `bin/format`
- [x] Compose `format-ts` + `format-shell`

### 6. Create `bin/typecheck`
- [x] Run `bunx tsc --noEmit`

### 7. Create `bin/test`
- [x] Run `bun test --timeout 30000 --parallel "$@"`

### 8. Create `bin/test-integration`
- [x] Verify `BROWSER_TOOL_VISION_BASE_URL` is reachable (warn but continue if not)
- [x] Test the library entrypoint: `bun run eval/e2e.ts`
- [x] Test the CLI entrypoint: run `browser-tool navigate --url <fixture>` and verify JSON output
- [x] Test the MCP server entrypoint: send JSON-RPC `initialize` + `tools/list` and verify 10 tools
- [x] Print PASS/FAIL summary

### 9. Create `bin/check`
- [x] Run `format`, `typecheck`, `test`, `test-integration` in sequence (set -e)

### 10. Make all bin scripts executable
- [x] `chmod +x bin/* env.sh`

### 11. Update documentation
- [x] Add `bin/` scripts section to `README.md` (prefer bin scripts over npm scripts)
- [x] Add `bin/` to `.gitignore` exemption if needed
- [x] Update `docs/developers.md` with bin/check workflow

## Discovered Tasks

### 12. Fix visionBaseUrl double /v1 bug

The Anthropic SDK automatically appends `/v1/messages` to `baseURL`. With the current default
`http://localhost:4000/flex/v1`, the actual request goes to `/flex/v1/v1/messages` → 404.

- [x] Change `src/config.ts` default `visionBaseUrl` from `http://localhost:4000/flex/v1` to `http://localhost:4000/flex`
- [x] Update `.env`: `BROWSER_TOOL_VISION_BASE_URL=http://localhost:4000/flex`
- [x] Update `README.md` config table
- [x] Update `docs/users.md` references
- [x] Verify `eval/e2e.ts` vision step passes

## Notes
- Follow the sailresearch-proxy pattern exactly: `source env.sh` from each script, scripts call each other by name via PATH.
- Direct all agents and humans to prefer bin scripts over `bun run` npm scripts.
- `test-integration` must exercise all three entrypoints: library (eval/e2e.ts), CLI, and MCP server.
- Shell formatting (`shfmt`) is included for future-proofing even though there are no shell scripts yet.
