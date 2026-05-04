import { test, expect, beforeAll, afterAll, afterEach } from "bun:test";
import {
  browserNavigate,
  browserSnapshot,
  browserClick,
  browserType,
  SessionManager,
  resetConfig,
} from "../src/index.js";
import { Mutex } from "../src/session/manager.js";
import { startFixtureServer, type FixtureServer } from "./fixtures/server.js";

let fixtures: FixtureServer | null = null;

beforeAll(async () => {
  fixtures = await startFixtureServer();
});

afterAll(async () => {
  await SessionManager.getInstance().closeAll();
  if (fixtures) await fixtures.stop();
  delete process.env.BROWSER_MAX_SESSIONS;
  resetConfig();
});

afterEach(async () => {
  await SessionManager.getInstance().closeAllSessions();
  delete process.env.BROWSER_MAX_SESSIONS;
  resetConfig();
});

// ---------------------------------------------------------------------------
// Task 8: Parallel same-taskId calls are serialized
// ---------------------------------------------------------------------------

test("parallel calls with the same taskId are serialized (no interleaving)", async () => {
  const url = `${fixtures!.url}/form.html`;
  const taskId = "concurrent-same";

  // Fire 5 navigates concurrently with the same taskId.
  // The mutex should serialize them — each should succeed in order.
  const results = await Promise.all(
    Array.from({ length: 5 }, (_, i) =>
      browserNavigate({
        url: `${fixtures!.url}/about?t=${i}`,
        taskId,
      }),
    ),
  );

  for (const r of results) {
    expect(r.success).toBe(true);
  }

  // After all resolves, the page should be on the last-navigated URL.
  // (Since they're serialized, the last one to run wins.)
  const session = SessionManager.getInstance().get(taskId);
  expect(session).toBeDefined();
  expect(session!.page.url()).toContain("/about");
});

test("Mutex serializes concurrent operations", async () => {
  const mutex = new Mutex();
  const order: string[] = [];

  // Create 3 async operations that would interleave without the mutex
  const ops = [1, 2, 3].map((n) =>
    mutex.runExclusive(async () => {
      order.push(`start-${n}`);
      // Simulate async work
      await new Promise((r) => setTimeout(r, 10));
      order.push(`end-${n}`);
    }),
  );

  await Promise.all(ops);

  // Each start should be followed by its corresponding end (no interleaving)
  for (let i = 0; i < order.length; i += 2) {
    const startIdx = Math.floor(i / 2) + 1;
    expect(order[i]).toBe(`start-${startIdx}`);
    expect(order[i + 1]!).toBe(`end-${startIdx}`);
  }
});

// ---------------------------------------------------------------------------
// Task 9: Parallel different-taskId calls work independently
// ---------------------------------------------------------------------------

test("parallel calls with different taskIds work independently", async () => {
  const taskIds = ["parallel-a", "parallel-b", "parallel-c"];
  const urls = taskIds.map(
    (_, i) => `${fixtures!.url}/${i === 0 ? "form.html" : "about"}`,
  );

  const results = await Promise.all(
    taskIds.map((id, i) =>
      browserNavigate({ url: urls[i]!, taskId: id }),
    ),
  );

  for (const r of results) {
    expect(r.success).toBe(true);
  }

  // Each session should have its own page
  const mgr = SessionManager.getInstance();
  for (let i = 0; i < taskIds.length; i++) {
    const session = mgr.get(taskIds[i]!)!;
    expect(session).toBeDefined();
    if (i === 0) {
      expect(session!.page.url()).toContain("/form.html");
    } else {
      expect(session!.page.url()).toContain("/about");
    }
  }
  expect(mgr.size()).toBe(3);
});

// ---------------------------------------------------------------------------
// Task 10: Max sessions limit is enforced
// ---------------------------------------------------------------------------

test("max sessions limit is enforced", async () => {
  process.env.BROWSER_MAX_SESSIONS = "2";
  resetConfig();

  const url = `${fixtures!.url}/form.html`;

  // First two sessions should succeed
  const r1 = await browserNavigate({ url, taskId: "limit-1" });
  const r2 = await browserNavigate({ url, taskId: "limit-2" });
  expect(r1.success).toBe(true);
  expect(r2.success).toBe(true);
  expect(SessionManager.getInstance().size()).toBe(2);

  // Third session should fail with limit error
  const r3 = await browserNavigate({ url, taskId: "limit-3" });
  expect(r3.success).toBe(false);
  expect(r3.success ? "" : r3.error).toContain("Session limit reached");

  // Reusing an existing taskId should still work (no new session created)
  const r4 = await browserNavigate({ url, taskId: "limit-1" });
  expect(r4.success).toBe(true);
  expect(SessionManager.getInstance().size()).toBe(2);
});

test("closing a session frees a slot under the limit", async () => {
  process.env.BROWSER_MAX_SESSIONS = "2";
  resetConfig();

  const url = `${fixtures!.url}/form.html`;

  await browserNavigate({ url, taskId: "slot-1" });
  await browserNavigate({ url, taskId: "slot-2" });

  // Limit reached
  const r3 = await browserNavigate({ url, taskId: "slot-3" });
  expect(r3.success).toBe(false);

  // Close one session
  await SessionManager.getInstance().close("slot-1");

  // Now a new session should succeed
  const r4 = await browserNavigate({ url, taskId: "slot-3" });
  expect(r4.success).toBe(true);
});

// ---------------------------------------------------------------------------
// Task 11: Buffer atomicity under concurrent access
// ---------------------------------------------------------------------------

test("session buffers respect limits under rapid pushes", async () => {
  const url = `${fixtures!.url}/console.html`;
  const r = await browserNavigate({ url, taskId: "buffer-test" });
  expect(r.success).toBe(true);

  const session = SessionManager.getInstance().get("buffer-test")!;
  expect(session).toBeDefined();

  // Directly stress-test the buffer push methods
  const LIMIT = 1000; // CONSOLE_BUFFER_LIMIT
  for (let i = 0; i < LIMIT + 100; i++) {
    session.pushConsole({
      type: "log",
      text: `msg-${i}`,
      timestamp: Date.now(),
    });
  }

  // Buffer should be capped at LIMIT
  expect(session.consoleBuffer.length).toBeLessThanOrEqual(LIMIT);

  // The oldest entries should have been evicted — most recent should be present
  const lastEntry = session.consoleBuffer[session.consoleBuffer.length - 1]!;
  expect(lastEntry.text).toBe(`msg-${LIMIT + 99}`);

  // Error buffer
  const ERR_LIMIT = 500;
  for (let i = 0; i < ERR_LIMIT + 100; i++) {
    session.pushError({
      message: `err-${i}`,
      timestamp: Date.now(),
    });
  }
  expect(session.errorBuffer.length).toBeLessThanOrEqual(ERR_LIMIT);
  const lastErr = session.errorBuffer[session.errorBuffer.length - 1]!;
  expect(lastErr.message).toBe(`err-${ERR_LIMIT + 99}`);

  // Network buffer
  const NET_LIMIT = 500;
  for (let i = 0; i < NET_LIMIT + 100; i++) {
    session.pushNetwork({
      url: `https://example.com/${i}`,
      method: "GET",
      status: 200,
      content_type: "text/html",
      size: 100,
      duration_ms: 10,
      resource_type: "document",
      request_headers: {},
      response_headers: {},
      timestamp: Date.now(),
    });
  }
  expect(session.networkBuffer.length).toBeLessThanOrEqual(NET_LIMIT);
  const lastNet = session.networkBuffer[session.networkBuffer.length - 1]!;
  expect(lastNet.url).toBe(`https://example.com/${NET_LIMIT + 99}`);
});

test("clearBuffer methods work correctly", async () => {
  const url = `${fixtures!.url}/console.html`;
  const r = await browserNavigate({ url, taskId: "clear-test" });
  expect(r.success).toBe(true);

  const session = SessionManager.getInstance().get("clear-test")!;

  // Push some data
  session.pushConsole({ type: "log", text: "hello", timestamp: 1 });
  session.pushError({ message: "err", timestamp: 1 });
  session.pushNetwork({
    url: "https://example.com",
    method: "GET",
    status: 200,
    content_type: "text/html",
    size: 0,
    duration_ms: 0,
    resource_type: "document",
    request_headers: {},
    response_headers: {},
    timestamp: 1,
  });

  expect(session.consoleBuffer.length).toBeGreaterThan(0);
  expect(session.errorBuffer.length).toBeGreaterThan(0);
  expect(session.networkBuffer.length).toBeGreaterThan(0);

  // Clear individually
  session.clearConsoleBuffer();
  expect(session.consoleBuffer.length).toBe(0);

  session.clearErrorBuffer();
  expect(session.errorBuffer.length).toBe(0);

  session.clearNetworkBufferInternal();
  expect(session.networkBuffer.length).toBe(0);

  // Push again and use clearBuffers (bulk)
  session.pushConsole({ type: "log", text: "hello2", timestamp: 2 });
  session.pushError({ message: "err2", timestamp: 2 });
  session.pushNetwork({
    url: "https://example.com/2",
    method: "GET",
    status: 200,
    content_type: "text/html",
    size: 0,
    duration_ms: 0,
    resource_type: "document",
    request_headers: {},
    response_headers: {},
    timestamp: 2,
  });

  session.clearBuffers();
  expect(session.consoleBuffer.length).toBe(0);
  expect(session.errorBuffer.length).toBe(0);
  expect(session.networkBuffer.length).toBe(0);
});
