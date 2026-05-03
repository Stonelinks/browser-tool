# TODO

## Goal
Add network request monitoring (with response bodies and filtering) as a new daemon action, and restructure SKILL.md to clearly separate general browsing from software-engineering debugging capabilities.

## Tasks

### 1. Add NetworkRequest type to `src/types.ts`
- [x] Add `NetworkRequest` interface with fields: url, method, status, content_type, size, duration_ms, resource_type, request_headers, response_headers, body, body_truncated, timestamp
- [x] Add `NetworkResult` interface with fields: requests, total, filtered

### 2. Add network interception to Session (`src/session/session.ts`)
- [x] Add `networkBuffer: NetworkRequest[]` with a cap (500 entries)
- [x] Listen to `page.on('response')` to capture request/response pairs
- [x] Capture response bodies for text-based content types only (skip images, fonts, media, etc.)
- [x] Truncate bodies over 100KB and set `body_truncated: true`
- [x] Add `clearNetworkBuffer()` method
- [x] Extend `clearBuffers()` to also clear network buffer

### 3. Create network action (`src/actions/network.ts`)
- [x] Accept optional `clear`, `filter.url_pattern` (regex), `filter.resource_type`, `filter.method`, `filter.status_code`, `task_id`
- [x] Return buffered network requests, applying filters
- [x] Support `clear: true` to empty buffer after returning

### 4. Register network action in schema and daemon
- [x] Add `NetworkSchema` to `src/schema.ts` with Zod validation
- [x] Add `browser_network` tool spec to `TOOL_SPECS` array
- [x] Export `browserNetwork` from `src/index.ts`
- [x] Register `/network` endpoint in `src/daemon.ts`

### 5. Add tests (`test/network.test.ts`)
- [x] Create test fixture HTML that triggers fetch/XHR requests
- [x] Test that network requests are captured with status, body, headers
- [x] Test filtering by resource_type and url_pattern
- [x] Test clear empties the buffer

### 6. Update SKILL.md with debugging section
- [x] Add clearly separated "Debugging & Development" section after the main workflow
- [x] Document `/network` action with all filter options and examples
- [x] Prominently feature `/console` for logs/errors/JS eval in the debugging section
- [x] Add guidance that debugging features are only needed for software engineering, not general browsing
- [x] Keep general browsing section unchanged

## Notes
- Response body capture is limited to text-based content types and truncated at 100KB to avoid memory issues
- The `/console` action already supports JS expression evaluation — no new `/execute` endpoint needed
- Network filtering happens at read time (not capture time), so all requests are always buffered
