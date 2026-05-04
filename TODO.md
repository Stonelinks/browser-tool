# TODO

## Goal
Make browser-tool safe for concurrent parallel execution by adding per-session locking, session limits, and fixing all identified concurrency hazards.

## Tasks

### 1. Add per-taskId promise-based mutex to SessionManager
- [x] Create a `Mutex` class using promise chaining (lock/unlock via acquire/release pattern)
- [x] Add a `Map<string, Mutex>` field to `SessionManager`
- [x] Add `runExclusive<T>(taskId: string, fn: () => Promise<T>): Promise<T>` method that acquires the per-taskId mutex, runs `fn`, then releases

### 2. Integrate locking into `withSession` transparently
- [x] Modify `withSession` in `src/actions/_helpers.ts` to wrap the entire getOrCreate+touch+fn call inside `SessionManager.getInstance().runExclusive(id, ...)`
- [x] Verify no caller API changes are needed (all 10 actions use `withSession` already)

### 3. Add max sessions config and enforcement
- [x] Add `maxSessions: number` to `Config` interface with env var `BROWSER_MAX_SESSIONS` defaulting to `20`
- [x] In `SessionManager.getOrCreate`, check `this.sessions.size >= cfg.maxSessions` before creating a new session; throw a descriptive error if limit is reached
- [x] Ensure existing sessions (same taskId) bypass the limit check (they reuse, not create)

### 4. Strengthen `getOrCreate` against creation races
- [x] Move the `existing` session check inside the `creating` promise chain so it's re-evaluated after awaiting an in-flight creation (defensive depth — the mutex makes this unlikely but defense-in-case)

### 5. Make Session buffer operations atomic
- [x] Extract `pushConsole(msg)`, `pushError(err)`, `pushNetwork(entry)` methods on `Session` that encapsulate the limit-check + shift + push logic
- [x] Replace all direct `this.consoleBuffer.push(...)` / `this.networkBuffer.push(...)` calls with the new methods
- [x] Add a `clearConsoleBuffer()`, `clearErrorBuffer()`, `clearNetworkBuffer()` method pair (replacing direct assignments in `clearBuffers` / `clearNetworkBuffer`)

### 6. Fix concurrent `pruneOldScreenshots` race in `browserVision`
- [x] Add a module-level `pruning: boolean` guard flag in `vision.ts`
- [x] Skip pruning if already in progress; set flag at start, clear on completion

### 7. Make `SessionManager.close` / `closeAll` explicitly re-entrant-safe
- [x] Add a `Set<string>` of `closing` taskIds to `SessionManager`
- [x] In `close(taskId)`, skip if taskId is in `closing`; add to set before closing, remove after
- [x] In `closeAllSessions`, use `Promise.allSettled` (already done) and add the closing guard

### 8. Add test: parallel same-taskId calls are serialized
- [x] Create `test/concurrency.test.ts`
- [x] Test: fire 5 `browserNavigate` calls with the same `taskId` concurrently; verify they execute sequentially (not interleaved) by checking that each sees a consistent page state

### 9. Add test: parallel different-taskId calls work independently
- [x] Test: fire `browserNavigate` calls with different `taskId`s concurrently; verify all succeed and each session is isolated

### 10. Add test: max sessions limit is enforced
- [x] Test: create sessions up to the limit; verify the next `getOrCreate` throws/returns an error
- [x] Test: reusing an existing taskId within the limit succeeds

### 11. Add test: buffer atomicity under concurrent access
- [x] Test: rapidly push console messages from multiple concurrent page.evaluate calls; verify no messages are lost and buffer limit is respected

## Notes
- Bun's single-threaded event loop means true data races are unlikely in practice, but the fixes make the code correct-by-design and safe for future Worker-based parallelism.
- The mutex is promise-based (no native threads needed), relying on the JS microtask queue for serialization.
- `withSession` is the single chokepoint for all 10 actions, so the lock integration is minimal and no caller API changes are needed.
- The max sessions limit of 20 is configurable via `BROWSER_MAX_SESSIONS` env var.
