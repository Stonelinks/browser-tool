import { test, expect, describe, mock, beforeEach, afterEach } from "bun:test";
import { createDaemonHandler, json } from "../src/daemon-handler.js";
import { SessionManager } from "../src/session/manager.js";
import type { ActionHandler } from "../src/daemon-handler.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a Request object for the daemon handler. */
function req(
  method: string,
  path: string,
  body?: Record<string, unknown>,
): Request {
  const init: RequestInit = {
    method,
    headers: { "Content-Type": "application/json" },
  };
  if (body !== undefined) {
    init.body = JSON.stringify(body);
  }
  return new Request(`http://localhost${path}`, init);
}

/** Parse a Response from the daemon handler. */
async function parse<T = Record<string, unknown>>(res: Response): Promise<T> {
  expect(res.headers.get("Content-Type")).toBe("application/json");
  return (await res.json()) as T;
}

// ---------------------------------------------------------------------------
// Stub actions
// ---------------------------------------------------------------------------

/** Create a stub action that records its call and returns a fixed result. */
function stubAction(result: Record<string, unknown>): {
  handler: ActionHandler;
  calls: Record<string, unknown>[];
} {
  const calls: Record<string, unknown>[] = [];
  const handler: ActionHandler = async (body) => {
    calls.push(body);
    return result;
  };
  return { handler, calls };
}

/** Create an action that always throws. */
function failingAction(msg: string): ActionHandler {
  return async () => {
    throw new Error(msg);
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("json helper", () => {
  test("returns a Response with correct status and JSON body", async () => {
    const res = json(201, { hello: "world" });
    expect(res.status).toBe(201);
    expect(res.headers.get("Content-Type")).toBe("application/json");
    const body = await res.json();
    expect(body).toEqual({ hello: "world" });
  });
});

describe("daemon handler", () => {
  // Reset the singleton between tests so session count is predictable.
  beforeEach(() => {
    SessionManager.resetForTesting();
  });
  afterEach(() => {
    SessionManager.resetForTesting();
  });

  test("GET /health returns ok with session count", async () => {
    const handler = createDaemonHandler({});
    const res = await handler(req("GET", "/health"));
    expect(res.status).toBe(200);
    const body = await parse(res);
    expect(body.ok).toBe(true);
    expect(typeof body.sessions).toBe("number");
  });

  test("POST /close-all returns ok", async () => {
    const handler = createDaemonHandler({});
    const res = await handler(req("POST", "/close-all"));
    expect(res.status).toBe(200);
    const body = await parse(res);
    expect(body.ok).toBe(true);
  });

  test("POST /shutdown returns ok and shutting down message", async () => {
    // We override process.exit so the test runner isn't killed.
    const origExit = process.exit;
    const exitCalls: number[] = [];
    process.exit = ((code: number) => {
      exitCalls.push(code);
    }) as never;

    try {
      const handler = createDaemonHandler({});
      const res = await handler(req("POST", "/shutdown"));
      expect(res.status).toBe(200);
      const body = await parse(res);
      expect(body.ok).toBe(true);
      expect(body.message).toBe("shutting down");
      // The exit happens asynchronously — give it a tick.
      await new Promise((r) => setTimeout(r, 50));
      expect(exitCalls).toContain(0);
    } finally {
      process.exit = origExit;
    }
  });

  test("unknown GET endpoint returns 404", async () => {
    const handler = createDaemonHandler({});
    const res = await handler(req("GET", "/unknown"));
    expect(res.status).toBe(404);
    const body = await parse(res);
    expect(body.success).toBe(false);
    expect(body.error).toContain("Unknown endpoint");
  });

  test("unknown POST endpoint returns 404", async () => {
    const handler = createDaemonHandler({});
    const res = await handler(req("POST", "/nonexistent", { a: 1 }));
    expect(res.status).toBe(404);
    const body = await parse(res);
    expect(body.success).toBe(false);
    expect(body.error).toContain("Unknown endpoint");
  });

  test("POST to a registered action forwards body and returns result", async () => {
    const { handler: navigateHandler, calls } = stubAction({
      success: true,
      title: "Test",
    });
    const handler = createDaemonHandler({ navigate: navigateHandler });

    const res = await handler(
      req("POST", "/navigate", { url: "https://example.com", task_id: "t1" }),
    );
    expect(res.status).toBe(200);
    const body = await parse(res);
    expect(body.success).toBe(true);
    expect(body.title).toBe("Test");
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe("https://example.com");
    expect(calls[0]!.task_id).toBe("t1");
  });

  test("POST action with invalid JSON body returns 400", async () => {
    const { handler: navigateHandler } = stubAction({ success: true });
    const handler = createDaemonHandler({ navigate: navigateHandler });

    const r = new Request("http://localhost/navigate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "not-json{{{",
    });
    const res = await handler(r);
    expect(res.status).toBe(400);
    const body = await parse(res);
    expect(body.success).toBe(false);
    expect(body.error).toContain("Invalid JSON body");
  });

  test("POST action that throws returns 500 with error message", async () => {
    const handler = createDaemonHandler({
      navigate: failingAction("navigation failed: timeout"),
    });
    const res = await handler(
      req("POST", "/navigate", { url: "http://bad" }),
    );
    expect(res.status).toBe(500);
    const body = await parse(res);
    expect(body.success).toBe(false);
    expect(body.error).toContain("navigation failed: timeout");
  });

  test("action with hyphenated name (e.g. get-images) works", async () => {
    const { handler: getImagesHandler, calls } = stubAction({
      success: true,
      images: [],
    });
    const handler = createDaemonHandler({ "get-images": getImagesHandler });

    const res = await handler(
      req("POST", "/get-images", { task_id: "img1" }),
    );
    expect(res.status).toBe(200);
    const body = await parse(res);
    expect(body.success).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.task_id).toBe("img1");
  });

  test("GET request to an action path returns 404 (only POST is routed to actions)", async () => {
    const { handler: navigateHandler } = stubAction({ success: true });
    const handler = createDaemonHandler({ navigate: navigateHandler });

    const res = await handler(req("GET", "/navigate"));
    expect(res.status).toBe(404);
  });

  test("trailing slash is stripped before routing", async () => {
    const handler = createDaemonHandler({});
    // /health/ should behave like /health
    const res = await handler(req("GET", "/health/"));
    expect(res.status).toBe(200);
    const body = await parse(res);
    expect(body.ok).toBe(true);
  });

  test("all 10 action names are routed correctly", async () => {
    const actionNames = [
      "navigate",
      "snapshot",
      "click",
      "type",
      "scroll",
      "back",
      "press",
      "console",
      "get-images",
      "vision",
    ];

    const calls: Record<string, Record<string, unknown>> = {};
    const actions: Record<string, ActionHandler> = {};
    for (const name of actionNames) {
      const stub = stubAction({ success: true, action: name });
      actions[name] = stub.handler;
      calls[name] = {} as Record<string, unknown>;
    }

    const handler = createDaemonHandler(actions);

    for (const name of actionNames) {
      const body = { action: name, task_id: `test-${name}` };
      const res = await handler(req("POST", `/${name}`, body));
      expect(res.status).toBe(200);
      const parsed = await parse(res);
      expect(parsed.success).toBe(true);
      expect(parsed.action).toBe(name);
    }
  });

  test("empty body on action endpoint returns 400", async () => {
    const { handler: clickHandler } = stubAction({ success: true });
    const handler = createDaemonHandler({ click: clickHandler });

    // POST with no body — req.json() should fail
    const r = new Request("http://localhost/click", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });
    const res = await handler(r);
    expect(res.status).toBe(400);
    const body = await parse(res);
    expect(body.error).toContain("Invalid JSON body");
  });

  test("action handler receives snake_case keys as-is", async () => {
    const { handler: typeHandler, calls } = stubAction({ success: true });
    const handler = createDaemonHandler({ type: typeHandler });

    await handler(
      req("POST", "/type", {
        ref: "@e1",
        text: "hello",
        submit: true,
        task_id: "t1",
      }),
    );

    expect(calls).toHaveLength(1);
    const call = calls[0]!;
    expect(call.ref).toBe("@e1");
    expect(call.text).toBe("hello");
    expect(call.submit).toBe(true);
    expect(call.task_id).toBe("t1");
  });
});
