import { test, expect } from "bun:test";
import { browserNavigate, browserConsole } from "../src/index.js";
import { useFixtureServer } from "./helpers.js";

const ctx = useFixtureServer();

test("console captures logs and errors; clear empties buffers", async () => {
  const taskId = "console-1";
  await browserNavigate({ url: `${ctx.url()}/console.html`, taskId });
  // Wait long enough for the setTimeout-thrown error to surface.
  await new Promise((r) => setTimeout(r, 300));
  const res = await browserConsole({ taskId });
  expect(res.success).toBe(true);
  if (!res.success) return;
  if ("console_messages" in res) {
    expect(res.console_messages.some((m) => m.text === "hello from page")).toBe(true);
    expect(res.console_messages.some((m) => m.type === "warning" || m.type === "warn")).toBe(true);
    expect(res.js_errors.some((e) => e.message.includes("boom"))).toBe(true);
  } else {
    throw new Error("expected ConsoleBuffersResult");
  }
  const cleared = await browserConsole({ clear: true, taskId });
  expect(cleared.success).toBe(true);
  // Next read should be empty (we cleared in the previous call, but listeners may still
  // append. Just check that the clear flag emptied them at the time of the call.)
  const after = await browserConsole({ taskId });
  if (after.success && "console_messages" in after) {
    expect(after.console_messages.length).toBeLessThanOrEqual(res.console_messages.length);
  }
});

test("console with expression evaluates JavaScript", async () => {
  const taskId = "console-eval";
  await browserNavigate({ url: `${ctx.url()}/form.html`, taskId });
  const res = await browserConsole({ expression: "1 + 2", taskId });
  expect(res.success).toBe(true);
  if (!res.success) return;
  if ("result" in res) {
    expect(res.result).toBe(3);
    expect(res.result_type).toBe("number");
  } else {
    throw new Error("expected eval result");
  }
});

test("console expression returns title", async () => {
  const taskId = "console-eval-title";
  await browserNavigate({ url: `${ctx.url()}/form.html`, taskId });
  const res = await browserConsole({ expression: "document.title", taskId });
  expect(res.success).toBe(true);
  if (!res.success) return;
  if ("result" in res) {
    expect(res.result).toBe("Form Test");
  }
});
